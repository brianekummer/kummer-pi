// Pi Status
// June 2017
//
// Get the status of the pi and send it to my phone. This in intended to be run
// several times a day.
//
//
// Command-Line Parameters
// -----------------------
// Syntax:     node pi-status.js [loglevel]
// Parameters: loglevel...Is optional. Determines the loglevel used:
//                        error|warn|info|verbose (default is "error")
//
// However, this script is configured via a number of environment variables,
// and one way of executing it is as follows:
//   sh -ac '. ./kummer-pi.env; node pi-status.js verbose'
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
// - node-env-configuration - xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//
//
// Notes
// -----
//   - NextCloud Notes API (https://github.com/nextcloud/notes/wiki/Notes-0.2)
//      - Need to use "Basic Auth" (add username and password to header)
//      - To get all notes, use url https://cluckcluck.us/index.php/apps/notes/api/v0.2/notes


var moment = require("moment");
var fs = require("fs");
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


getPiStatus();
return;



function getPiStatus() {
  if (logger.level == "verbose")
    logger.verbose("------------------------------------------------------------");

  var runDate = moment().format("YYYYMMDDHHmm");


  if (utils.nextCloudIsInstalled()) {
    var piDailyStats = utils.readExistingJsonFile(path.join(__dirname, "pi-daily-stats.json"));
    logger.verbose(format("Daily stats: Run={0}; NC: DB={1}mb, Latest Ver={2}; Notes: #={3}, Last Bkp={4}, Brian Note Id={5}; SSL Cert: Expires={6} days",
      piDailyStats.runDate, 
      piDailyStats.nextCloudDbSizeMb, piDailyStats.nextCloudLatestVersion, 
      piDailyStats.nextCloudNotesNumberOf, piDailyStats.nextCloudNotesLastBackup, piDailyStats.nextCloudNoteBrianNoteId,
      piDailyStats.sslCertificateDaysUntilExpires));
  }
  
  var diskUsage = getDiskUsage();
  logger.verbose(format("Disk: int={0}%", diskUsage.internal));

  var memoryUsage = getMemoryUsage();
  logger.verbose(format("Memory: int={0}%, swap={1}%", memoryUsage.internal, memoryUsage.swap));

  var swapping = getSwapping();
  logger.verbose(format("Swapping: in={0}, out={1}", swapping.in, swapping.out));

  var averageLoad = getAverageLoad();
  logger.verbose(format("Avg Load: 5={0}, 15={1}", averageLoad.fiveMin, averageLoad.fifteenMin));



  var kodi = getKodiStats();
  logger.verbose(format("Kodi: {0}, Ver={1}, Latest Ver={2}", kodi.status, kodi.currentVersion, kodi.latestVersion));

  var ufw = getUfwStats();
  logger.verbose(format("UFW: {0}", ufw.status));



  var router = getRouterStats();
  logger.verbose(format("Router: {0}, up {1}", router.currentVersion, router.upTime));
  logger.verbose(format("  Load: 1={0}, 5={1}, 15={2}", router.averageLoad.oneMin, router.averageLoad.fiveMin, router.averageLoad.fifteenMin));
  logger.verbose(format("  NAS storage: {0}% used", router.nasStorage));

  var nextCloudStats = {}; 
  var nextCloudNotesStats = {};
  if (utils.nextCloudIsInstalled()) {
    nextCloudStats = getNextCloudStats();
    logger.verbose(format("NextCloud: {0}, My Version={1}", nextCloudStats.upDown, nextCloudStats.myVersion));

    nextCloudNotesStats = getNextCloudNotesStats(piDailyStats.nextCloudNoteBrianNoteId);
    logger.verbose(format("NextCloud Notes: {0}", nextCloudNotesStats.upDown));
  }



  // Removed PiHole status, which is why there's a || where {14} used to be
  /*
  var piStatusMsg = format(
    "pi-1_status|{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7}|{8}|{9}|{10}|{11}|{12}|{13}||{14}|{15}|{16}|{17}|", 
    runDate,
    diskUsage.internal,
    //diskUsage.external,
    router.nasStorage,
    memoryUsage.internal,
    memoryUsage.swap,
    nextCloudStats.upDown,
    piDailyStats.nextCloudDbSizeMb,
    nextCloudStats.myVersion,
    piDailyStats.nextCloudLatestVersion,
    piDailyStats.sslCertificateDaysUntilExpires,
    piDailyStats.nextCloudLastBackup,
    nextCloudNotesStats.upDown,
    piDailyStats.nextCloudNotesNumberOf,
    piDailyStats.nextCloudNotesLastBackup,
    swapping.in,
    swapping.out,
    averageLoad.fiveMin,
    averageLoad.fifteenMin);

  utils.sendMessageToPhone(utils.configuration.family["brian"], piStatusMsg);
  */


  // New message to my phone
  var hostName = utils.getHostName();
  var piNumber = hostName[hostName.length-1];


  var piStatusNew = {
    message_datetime: runDate,
    pi:{
      disk_internal: diskUsage.internal,
      memory_internal: memoryUsage.internal,
      memory_swap: memoryUsage.swap,
      swapping_in: swapping.in,
      swapping_out: swapping.out,
      load_one_min: averageLoad.oneMin,
      load_five_min: averageLoad.fiveMin,
      load_fifteen_min: averageLoad.fifteenMin,
    },
    kodi:{
      status: kodi.status,
      current_version: kodi.currentVersion,
      latest_version: kodi.latestVersion
    },
    ufw:{
      status: ufw.status
    },
    router:{
      current_version: router.currentVersion[0],
      uptime: router.uptime,
      load_one_min: router.averageLoad.oneMin,
      load_five_min: router.averageLoad.fiveMin,
      load_fifteen_min: router.averageLoad.fifteenMin,
      nas_storage_used: router.nasStorage
    },
  };

  if (utils.nextCloudIsInstalled()) {
    piStatusNew.nextcloud = {
      status: nextCloudStats.upDown,
      db_size: piDailyStats.nextCloudDbSizeMb,
      current_version: nextCloudStats.myVersion[0],
      latest_version: piDailyStats.nextCloudLatestVersion,
      ssl_cert_expiry: piDailyStats.sslCertificateDaysUntilExpires,
      last_backup: piDailyStats.nextCloudLastBackup
    };
    piStatusNew.nextcloud_notes = {
      status: nextCloudNotesStats.upDown,
      last_backup: piDailyStats.nextCloudNotesLastBackup
    };
  }
  piStatusMsg = format("pi_{0}_status_new|{1}|", piNumber, JSON.stringify(piStatusNew));
  utils.sendMessageToPhone(utils.configuration.family["brian"], piStatusMsg);



  if (logger.level == "info") {
    logger.info(format("PI: " +
      "Disk: i={0}%, " +
      "Memory: i={1}%, s={2}%; " + 
      "Swap: in={3}, out={4}; " +
      "Load: 1m={5}, 5m={6}, 15m={7}",
      diskUsage.internal, 
      memoryUsage.internal, memoryUsage.swap,
      swapping.in, swapping.out,
      averageLoad.oneMin, averageLoad.fiveMin, averageLoad.fifteenMin));
    logger.info(format("KODI: {0}, Versions={1}/{2}", kodi.status, kodi.currentVersion, kodi.latestVersion));
    logger.info(format("UFW: {0}", ufw.status));
    logger.info(format("ROUTER: {0}, up {1}; Load: 1m={2}, 5m={3}, 15m={4}; NAS={5}%", router.currentVersion, router.uptime, router.averageLoad.oneMin,
      router.averageLoad.fiveMin, router.averageLoad.fifteenMin, router.nasStorage));
    if (utils.nextCloudIsInstalled()) {
      logger.info(format("NEXTCLOUD: {0}, DB={1} mb, Versions={2}/{3}, SSL={4} days, Bkp={5}; " +
        "Notes: {6}, #={7}, Bkp={8}",
        nextCloudStats.upDown, piDailyStats.nextCloudDbSizeMb, nextCloudStats.myVersion, piDailyStats.nextCloudLatestVersion, piDailyStats.sslCertificateDaysUntilExpires, piDailyStats.nextCloudLastBackup,
        nextCloudNotesStats.upDown, piDailyStats.nextCloudNotesNumberOf, piDailyStats.nextCloudNotesLastBackup));
    }
  }
}


function getMemoryUsage() {
  // Based on how NextCloud shows memory usage: https://github.com/nextcloud/serverinfo/blob/master/lib/SystemStatistics.php
  var values = utils
    .executeShellCommand("cat /proc/meminfo")
    .split("\n");
  var list = new Map();
  var parts = null;
  
  values.forEach(v => {
    parts = v.split(":");
    if (parts[1] !== undefined)
      list.set(parts[0], parts[1].match(/\d+/));
  });

  memoryUsedInternal = Math.round(
    (list.get("MemTotal") - list.get("MemAvailable")) /
    list.get("MemTotal")*100);

  memoryUsedSwap = Math.round(
    (list.get("SwapTotal") - list.get("SwapFree")) /
    list.get("SwapTotal")*100);
  
  return {
    internal: memoryUsedInternal,
    swap:     memoryUsedSwap
  };
}


function getDiskUsage() {
  const DF_COLUMN_USED = 2;
  const DF_COLUMN_AVAILABLE = 3;

  var usedInternal = 0;
  var usedExternal = 0;
  var availableInternal = 0;
  var availableExternal = 0;

  // Get disk usage of all other storage (internal)
  utils
    .executeShellCommand("df -BM | grep --invert external_usb | grep --invert Filesystem")
    .replace(/\s\s+/g, " ")      // convert multiple spaces into one space
    .split("\n")
    .forEach(v => {
      parts = v.split(" ");
      if (parts[1] !== undefined) {
        usedInternal += Number(parts[DF_COLUMN_USED].match(/\d+/));
        availableInternal += Number(parts[DF_COLUMN_AVAILABLE].match(/\d+/));
      }
    });

  return {
    internal: Math.round(usedInternal/availableInternal*100),
  };
}


function getSwapping() {
  const VMSTAT_COLUMN_SWAPPED_IN = 7;
  const VMSTAT_COLUMN_SWAPPED_OUT = 8;

  var parts = utils
    .executeShellCommand("vmstat | tail -n 1")
    .replace(/\s\s+/g, " ")      // convert multiple spaces into one space
    .split(" ");
  var swappedIn = parts[VMSTAT_COLUMN_SWAPPED_IN];
  var swappedOut = parts[VMSTAT_COLUMN_SWAPPED_OUT]; 

  return {
    in: swappedIn,
    out: swappedOut
  };
}


function getAverageLoad() {
  //var parts = utils
  //  .executeShellCommand("uptime")
  //  .replace(/\s/g, "")      // remove all spaces
  //  .split(",");

  //return {
  //  oneMin: parts[parts.length-3],
  //  fiveMin: parts[parts.length-2],
  //  fifteenMin: parts[parts.length-1]
  //};


  var uptimeStats = utils.executeShellCommand("uptime");
  var loads = /load average\: ([^,]+), ([^,]+), ([\d\.]+)/i.exec(uptimeStats);
  return {
    oneMin: loads[1],
    fiveMin: loads[2],
    fifteenMin: loads[3]
  };
}


function getKodiStats() {
  var cmd = "";

  var status;
  try {
    cmd = "curl --silent http://localhost:8080";
    var kodiWebPage = utils.executeShellCommand(cmd);
    status = kodiWebPage != "" ? "up" : "down";
  }
  catch (ex) {
    status = "down";
  }

  cmd = "apt-cache policy kodi | grep -E '(Installed|Candidate)'";
  var kodiVersions = utils.executeShellCommand(cmd);
  var kodiVersionNumbers = kodiVersions.match(/\d+\.\d+/g);

  return {
    status: status,
    currentVersion: kodiVersionNumbers[0],
    latestVersion: kodiVersionNumbers[1]
  };
}


function getUfwStats() {
  var cmd = "sudo ufw status | grep -c 'ALLOW'";
  var numUfwRules = utils.executeShellCommand(cmd);
  var status = numUfwRules > 0 ? "up" : "down";
  
  return {
    status: status
  };
}


function getRouterStats() {
  const DF_COLUMN_USED = 2;
  const DF_COLUMN_AVAILABLE = 3;

  var routerInfo = utils.executeShellCommand("curl -ks https://router.kummer");

  var version = routerInfo.match(/DD-WRT v\d+\.\d+\-.*\(\d+\/\d+\/\d+\)/i);
  var uptimeStats = routerInfo.match(/<span id=\"uptime\">.*?<\/span>/gim)[0];
  var uptime = /up ([^,]+),/i.exec(uptimeStats)[1];
  var loads = /load average\: ([^,]+), ([^,]+), ([^<]+)<\/span>/i.exec(uptimeStats);

  var parts = utils
    .executeShellCommand("df -aBM | grep '//router.kummer'")
    .replace(/\s\s+/g, " ")      // convert multiple spaces into one space
    .split(" ");
  var nasStorageUsed = Number(parts[DF_COLUMN_USED].match(/\d+/));
  var nasStorageAvailable = Number(parts[DF_COLUMN_AVAILABLE].match(/\d+/));

  return {
    currentVersion: version,
    uptime: uptime,
    averageLoad: {
      oneMin: loads[1],
      fiveMin: loads[2],
      fifteenMin: loads[3]
    },
    nasStorage: Math.round(nasStorageUsed/nasStorageAvailable*100)
  };
}


function getNextCloudStats() {
/******************************************************************************************
* Gets the status of NextCloud
*  - upDown:        up|down. When up, getting status returns something like this:
*                   {"installed":"true","version":"6.0.0.16","versionstring":"6.0.1","edition":""}  
*                   https://docs.nextcloud.com/server/11/admin_manual/operations/considerations_on_monitoring.html
*  - myVersion:     is the "versionstring" property of the status
*
*  These are calculated once per day by pi-daily-stats.js
*  - dbSizeInMb:    http://stackoverflow.com/questions/9620198/how-to-get-the-sizes-of-the-tables-of-a-mysql-database
*  - latestVersion: latest version available on https://download.nextcloud.com/server/releases/
******************************************************************************************/
  var upDown = null;
  var myVersion = null;

  var cmd = null;

  try {
    myVersion = utils
      .executeShellCommand("sudo -u www-data php /var/www/nextcloud/status.php | grep version")
      .match(/[\d\.]+/);
    upDown = "up";
  }
  catch (ex) {
    upDown = "down";
  }

  return {
    upDown:    upDown,
    myVersion: myVersion,
  };
}      


function getNextCloudNotesStats(nextCloudNoteBrianNoteId) {
/******************************************************************************************
* Gets the status of NextCloud notes
* - upDown:        up|down. Test if it is up by retrieving id of one of my notes, then query
*                  Notes API and see if it returns data.
******************************************************************************************/
  var upDown = null;
  var cmd = null;

  var brian = utils.configuration.family["brian"];
  try {
    cmd = format("curl --silent --user {0}:{1} {2}/notes/{3}{4}",
      brian.name, brian.nextcloud.scripts.password,
      utils.configuration.nextcloud.notes.base.url, nextCloudNoteBrianNoteId, "?exclude=modified,category,favorite,title,content,etag");
    var note = utils.executeShellCommand(cmd);
//logger.verbose("CMD=" + cmd);
//logger.verbose("   Result=" + note);
    upDown = (note.id != nextCloudNoteBrianNoteId ? "up" : "down");
  }
  catch (ex) {
    // Sometimes this CURL command fails with a status of 16, which means "HTTP/2 error. A problem was detected in the HTTP2 framing layer.",
    // but the correct output is in ex.stdout.
    if (ex.status == 16) {
      var note = ex.stdout;
      upDown = (note != null && note.id != nextCloudNoteBrianNoteId ? "up" : "down");
    }
    else {
//logger.verbose("ERROR checking Notes up/down: ex=" + ex);
//logger.verbose("   status=" + ex.status);
//logger.verbose("   stderr=" + ex.stderr.toString());
//logger.verbose("   stdout=" + ex.stdout.toString());
      upDown = "down";
    }
  }
  
  return {
    upDown: upDown
  };
}         
