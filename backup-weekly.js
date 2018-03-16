// Weekly Backup
// July 2017
//
// Backup the following
//   - NextCloud (https://docs.nextcloud.com/server/11/admin_manual/maintenance/backup.html)
//	    - config folder: /var/www/nextcloud/config
//      - data folder: /var/www/nextcloud/data
//			- themes folder: /var/www/nextcloud/themes
//      - the database dump - can be run from any folder!
//		     mysqldump --single-transaction --all-databases -uncadmin -pownyourbits > nextcloud-sqlbkp_`date +"%Y%m%d"`.bak
//      - the config.php (for settings & keys)
//	 - Other stuff			
//		  - SSL certificate: /etc/letsencrypt/live/cluckcluck.us (not sure what's all there)
//		  - SSH config: /etc/ssh/sshd_config
//			- SAMBA config: /etc/samba/smb.config
//			- crontab file: /etc/crontab
//      - startup file: /etc/rc.local
//			- My JS code and data
//			   - /home/pi/kummerjs/*json  (config, secrets, data)
//			   - /home/pi/kummerjs/*js    (code)
//			   - /home/pi/kummerjs/*dat   (encrypted config)
//			  - /home/pi/kummerjs/selenium-drivers/*    (phantomjs) do I want this??? How big is it?????
//   - Encrypt this zip file
//
//
// Command-Line Parameters
// -----------------------
// Syntax:     node backup-weekly.js [loglevel]
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
//
// However, this script is configured via a number of environment variables,
// and one way of executing it is as follows:
//   sh -ac '. ./kummer-pi.env; node backup-weekly.js verbose'


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

  backupNextCloud()
    .then(fileNames => utils.zipAndEncryptBackup(fileNames, "backup-weekly",
      utils.configuration.backups.path.weekly, "", true))
    .then(() => cleanupGoogleDriveFolder(utils.configuration.backups.path.weekly))
    .then(() => utils.syncToGoogleDrive(utils.configuration.backups.path.weekly, "Backups/Weekly"))
    .then(() => utils.deleteFiles(path.join(__dirname, "*bak")))
    .then(() => logger.info("Done"));
return;



function backupNextCloud() {
  // https://docs.nextcloud.com/server/12/admin_manual/maintenance/backup.html
  // https://github.com/nextcloud/nextcloudpi/blob/master/etc/nextcloudpi-config.d/nc-backup.sh
  logger.verbose("Backing up NC");

  return new Promise(function (resolve, reject) {
    var cmdOutput = utils.executeShellCommand(
      "sudo -u www-data php /var/www/nextcloud/occ maintenance:mode --on");
    logger.info("Turned NextCloud maintenance mode ON");
    
    var dbBackupFileName = path.join(__dirname, 
      format("nextcloud-sqlbkp-{0}.bak", moment().format("YYYYMMDD-HHmmss")));
    cmdOutput = utils.executeShellCommand(
      format("mysqldump " +
        "--single-transaction " +
        "--all-databases " +
        "-u{0} -p{1} " +
        "> {2}", 
        utils.configuration.nextcloud.db.username, 
        utils.configuration.nextcloud.db.password,
        dbBackupFileName));
    logger.verbose("Backup NC output = %s", cmdOutput);

    resolve([dbBackupFileName]);
  });
}


function cleanupGoogleDriveFolder(localFolderPath) {
  return new Promise(function (resolve, reject) {
    logger.verbose("LOCAL cleanupGoogleDriveFolder - %s", localFolderPath);

    // Delete backups older than 5 weeks (35 days)
    utils.cleanupGoogleDriveFolder(localFolderPath,
      format("find {0} -maxdepth 1 -not -mtime -{1} " +
             "| grep \"{2}\" " +
             localFolderPath, 35,
             "backup-weekly.*tar\.7z"));

    resolve ("junk");
  });
}
