// Pi Daily Stats 
// June 2017
//
// Calculate daily stats that will be sent as part of hourly status updates from the Pi,
// but don't need calculated every hour.
//
// Command-Line Parameters
// -----------------------
// Syntax:     node pi-daily-stats.js [loglevel]
// Parameters: loglevel...Is optional. Determines the loglevel used:
//                        error|warn|info|verbose (default is "error")
//
// However, this script is configured via a number of environment variables,
// and one way of executing it is as follows:
//   sh -ac '. ./kummer-pi.env; node pi-daily-stats.js verbose'
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
//
//
// Notes
// -----
//   - NextCloud Notes API (https://github.com/nextcloud/notes/wiki/Notes-0.2)
//      - Need to use "Basic Auth" (add username and password to header)
//      - To get all notes, use url https://cluckcluck.us/index.php/apps/notes/api/v0.2/notes,
//        and expect to be able to use "localhost"


var moment = require("moment");
var format = require("string-format");
var logger = require("winston");
var path = require("path");
var utils = require(path.join(__dirname, "kummer-utils.js"));

utils.configureLogger(logger, __filename);

// Define an uncaughtException error handler to log if something really bad happens
function uncaughtExceptionHandler(options, err) {
  logger.error("%s", err.stack);
}
process.on('uncaughtException', uncaughtExceptionHandler.bind(null, {exit:true}));



if (utils.isRunningOnWindows)
  throw new Error("This script -= MUST =- be run on the Pi");

calcPiDailyStats();
return;



function calcPiDailyStats() {
  var runDate = moment().format("YYYYMMDDHHmmss");

  var nextCloudStats = getNextCloudStats();
  logger.verbose(format("NextCloud Db={0} mb, Latest Version={1}, Last Bkp={2}", nextCloudStats.dbSizeMb, nextCloudStats.latestVersion, nextCloudStats.lastBackup));

  var nextCloudNotesStats = getNextCloudNotesStats();
  logger.verbose(format("NextCloud Notes #={0}, Last Bkp={1}", nextCloudNotesStats.numberOf, nextCloudNotesStats.lastBackup));

  var sslCertificateInfo = getSslCertificateInfo();
  logger.verbose(format("SSL Cert: Days until expire={0}", sslCertificateInfo.daysUntilExpires));

  var piDailyStats = {
    runDate:                        runDate,
    nextCloudDbSizeMb:              nextCloudStats.dbSizeMb,
    nextCloudLatestVersion:         nextCloudStats.latestVersion,
    nextCloudLastBackup:            nextCloudStats.lastBackup,
    nextCloudNotesNumberOf:         nextCloudNotesStats.numberOf,
    nextCloudNotesLastBackup:       nextCloudNotesStats.lastBackup,
    nextCloudNoteBrianNoteId:       nextCloudNotesStats.brianNoteId,
    sslCertificateDaysUntilExpires: sslCertificateInfo.daysUntilExpires
  };

  logger.info("NC: DB=%s mb, Latest Version=%s Last Bkp=%s; Notes: #=%s, Last Bkp=%s; SSL=%s days", 
    piDailyStats.nextCloudDbSizeMb, piDailyStats.nextCloudLatestVersion, piDailyStats.nextCloudLastBackup,
    piDailyStats.nextCloudNotesNumberOf, piDailyStats.nextCloudNotesLastBackup,
    piDailyStats.sslCertificateDaysUntilExpires);

  utils.saveJsonFile(path.join(__dirname, "pi-daily-stats.json"), piDailyStats);
}


function getNextCloudStats() {
/******************************************************************************************
* Gets the status of NextCloud
*  - dbSizeInMb:    http://stackoverflow.com/questions/9620198/how-to-get-the-sizes-of-the-tables-of-a-mysql-database
*  - latestVersion: latest version available on https://download.nextcloud.com/server/releases/
******************************************************************************************/
  var dbSizeMb = null;
  var latestVersion = null;
  var cmd = null;
  var lastBackupFileName = null;
  var lastBackup = null;
 
  dbSizeMb = utils.executeSqlCommand(
    "SELECT round(sum(data_length + index_length)/1024/1024,1) " +
      "FROM information_schema.TABLES " +
     "WHERE table_schema='nextcloud'");

  cmd = format(
    "curl --silent {0} " +
    "| grep -Po '(?<=\"nextcloud-).*(?=\.zip\")'" +
    "| tail -1", 
    utils.configuration.nextcloud.releases.url);
  latestVersion = utils.executeShellCommand(cmd);
  if (latestVersion == "") {
    // This is a hack, because sometimes nothing is returned
    utils.sleep(2000);
    latestVersion = utils.executeShellCommand(cmd);
  }

  // Get date of latest backup from google drive folder (/home/pi/GDrive/backups/weekly)
  lastBackupFileName = utils
     .executeShellCommand(
        format("ls -1a {0} | grep backup-weekly | tail -1",
          utils.configuration.backups.path.weekly));
  if (lastBackupFileName != "") {
    var temp = lastBackupFileName.match(/20\d\d\d\d\d\d/);
    if (temp.length > 0)
      lastBackup = temp[0];
  }

  return {
    dbSizeMb: dbSizeMb,
    latestVersion: latestVersion,
    lastBackup: lastBackup
  };
}			


function getNextCloudNotesStats() {
/******************************************************************************************
* Gets the status of NextCloud notes
* - numberOf:      Query database for files
*                    - Only want txt and md files in Notes subfolder
*                    - Only want original author's version (is why checking mount point)
* - lastBackup:  Get date/time of latest daily backup, which backs up notes
******************************************************************************************/
  var brianNoteId = null;
  var numberOf = null;
  var lastBackup = "";

  try {
    // I realize that using LOWER() in the query results in a full table scan,
    // but I couldn't quickly find a better way
    brianNoteId = utils.executeSqlCommand(
      "SELECT fileid " +
        "FROM oc_filecache fc " +
             "JOIN oc_mounts m ON fc.storage=m.storage_id " +
             "JOIN oc_mimetypes mt ON fc.mimetype=mt.id " +
            "WHERE mt.mimetype LIKE '%text%' " +
                  "AND fc.path LIKE 'files/Notes%' " +
                  "AND (fc.name LIKE '%.md' OR fc.name LIKE '%.txt') " +
                  "AND LOWER(fc.name) LIKE '%medical%' " +
            "LIMIT 1");
  }
  catch (ex) {
  }
	
  numberOf = utils.executeSqlCommand(
    "SELECT COUNT(*) " +
      "FROM oc_filecache fc " +
           "JOIN oc_mounts m ON fc.storage=m.storage_id " +
           "JOIN oc_mimetypes mt ON fc.mimetype=mt.id " +
     "WHERE mt.mimetype LIKE '%text%' " +
           "AND fc.path LIKE 'files/Notes%' " +
           "AND (fc.name LIKE '%.md' OR fc.name LIKE '%.txt') " +
           "AND m.mount_point = CONCAT('/', m.user_id, '/')");
	
  // Get date of latest backup from google drive folder (/home/pi/GDrive/backups/daily)
  var lastBackupFileName = utils
    .executeShellCommand(
      format("ls -1a {0} | grep backup-daily | tail -1", 
        utils.configuration.backups.path.daily));
  if (lastBackupFileName != "") {
    var temp = lastBackupFileName.match(/20\d\d\d\d\d\d/);
    if (temp.length > 0)
      lastBackup = temp[0];
  } 

  return {
    brianNoteId: brianNoteId,
    numberOf: numberOf,
    lastBackup: lastBackup
  };
}				 


function getSslCertificateInfo() {
/******************************************************************************************
* Gets the status of my SSL certificate from Let's Encrypt
*
* This command "certbot certificates" yields results like this:
*   Found the following certs:
*     Certificate Name: example.com
*       Domains: example.com, www.example.com
*       Expiry Date: 2017-02-19 19:53:00+00:00 (VALID: 30 days)
*       Certificate Path: /etc/letsencrypt/live/example.com/fullchain.pem
*       Private Key Path: /etc/letsencrypt/live/example.com/privkey.pem
*
* ssl-cert-check returns data like this
*   Host                                            Status       Expires      Days
*   ----------------------------------------------- ------------ ------------ ----
*   FILE:/etc/letsencrypt/live/cluckcluck.us/cert.pem Valid        Sep 18 2017  87
******************************************************************************************/
  var daysUntilExpires = null;
	
  var sslCertificateInfo = utils
    .executeShellCommand("sudo ssl-cert-check -c /etc/letsencrypt/live/cluckcluck.us/cert.pem");
  var expiration = sslCertificateInfo.match(/letsencrypt.*20\d\d\s+\d+/gim);
  if (expiration.length > 0) {
    daysUntilExpires = expiration[0].match(/\d+$/)[0];
  }

  return {
    daysUntilExpires: daysUntilExpires
  };
}
