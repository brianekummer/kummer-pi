// Daily Backup
// April 2017
//
// Backup the following
//   - NextCloud Notes
//   - kummer-data.json
//
// Command-Line Parameters
// -----------------------
// Syntax:     node backup-daily.js [loglevel]
//
// However, this script is configured via a number of environment variables,
// and one way of executing it is as follows:
//   sh -ac '. ./kummer-pi.env; node backup-daily.js verbose'
//
//
// Required NPM Packages
// ---------------------
// - Node fetch......Implements fetch for getting notes
//                   npm install node-fetch
// - MomentJS........For date logic
//                   npm install moment
// - String format...To simplify formatting strings in JavaScript
//                   npm install string-format
// - Winston.........Logging framework
//                   npm install winston
// - Tar.............Wrapper for tar
//                   npm install tar
// - Node-7z.........Wrapper for 7zip
//                   npm install node-7z
// - Promise.........Wrapper for promises
//                   npm install promise


var moment = require("moment");
var fs = require("fs");
var format = require("string-format");
var logger = require("winston");
var fetch = require('node-fetch');
var wuzzy = require('wuzzy');
var Promise = require("promise");
var path = require("path");
var utils = require(path.join(__dirname, "kummer-utils.js"));

utils.configureLogger(logger, __filename);

// Define an uncaughtException error handler to log if something really bad happens
function uncaughtExceptionHandler(options, err) {
  logger.error("%s", err.stack);
}
process.on('uncaughtException', uncaughtExceptionHandler.bind(null, {exit:true}));



logger.info("------------------------------------------------------------");
  if (utils.isRunningOnWindows) 
    throw new Error("This script -= MUST =- be run on the Pi");

  collectNotesForEachUser()
    .then(fileNames => utils.zipAndEncryptBackup(fileNames, "backup-daily", 
      utils.configuration.backups.path.daily,
       path.join(__dirname, "backup-daily.notes-*.json"), false))
    .then(() => cleanupGoogleDriveFolder(utils.configuration.backups.path.daily))
    .then(() => utils.syncToGoogleDrive(utils.configuration.backups.path.daily, "Backups/Daily"))
    .then(() => utils.deleteFiles(path.join(__dirname, "backup-daily.notes*")));
return;



function collectNotesForEachUser() {
  return new Promise(function (resolve, reject) {
    var promises = [];

    var familyMembersToBackup = utils
      .configuration
      .family
      .allMembers
      .filter(fm => fm.hasOwnProperty("nextcloud") && fm.nextcloud.scripts.password != null && fm.email != null)
      .forEach(fm => promises.push(getFamilyMemberNotes(fm)));

    Promise
      .all(promises)
      .then(fileNames => resolve(fileNames),
        error => logger.error("Error: %s",  error)
      );
  });
}


function getFamilyMemberNotes(familyMember) {
  return new Promise(function (resolve, reject) {
    logger.verbose("%s --> Getting all notes", familyMember.name);

    var url = format("{0}/notes", utils.configuration.nextcloud.notes.base.url);
    var fileName = path.join(__dirname, 
      format("backup-daily.notes-{0}.json", familyMember.name.toLowerCase()));
    var authorization =
      'Basic ' +
      new Buffer(format("{0}:{1}",
        familyMember.name,
        familyMember.nextcloud.scripts.password))
      .toString('base64');

    fetch(url, {
      method: 'get',
      headers: {
        'Authorization': authorization,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
    .then(r => r.json())
    .then(notes => {
      fs.writeFileSync(fileName, JSON.stringify(notes, null, 0), "utf8");
      resolve(fileName);
    })
  });
}


function cleanupGoogleDriveFolder(localFolderPath) {
  return new Promise(function (resolve, reject) {
    logger.verbose("LOCAL cleanupGoogleDriveFolder - %s", localFolderPath);

    // Delete backups older than 31 days, but keeping backups from the first of every month
    utils.cleanupGoogleDriveFolder(localFolderPath,
      format("find {0} -maxdepth 1 -not -mtime -{1} " +
             "| grep \"{2}\" " +
             "| grep --invert-match --regexp \"{3}\" ",
             localFolderPath, 31,
             "backup-daily.*tar\.7z", "backup-daily-.*01-"));

    resolve ("junk");
  });
}
