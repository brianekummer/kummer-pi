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
// - MomentJS........For date logic
//                   npm install moment
// - String format...To simplify formatting strings in JavaScript
//                   npm install string-format
// - Winston.........Logging framework
//                   npm install winston
// - Promise.........Wrapper for promises
//                   npm install promise


var moment = require("moment");
var fs = require("fs");
var format = require("string-format");
var logger = require("winston");
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

  createEmptyPromise() 
    .then(fileNames => utils.zipAndEncryptBackup(fileNames, "backup-daily", 
      utils.configuration.backups.path.daily, "", false))
    .then(() => cleanupGoogleDriveFolder(utils.configuration.backups.path.daily))
    .then(() => utils.syncToGoogleDrive(utils.configuration.backups.path.daily, "Backups/Daily"))
return;


function createEmptyPromise() {
  return new Promise(function (resolve, reject) {
    resolve("");
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
