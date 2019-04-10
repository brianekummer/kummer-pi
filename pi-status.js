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
  logger.verbose("------------------------------------------------------------");

  var runDate = moment().format("YYYYMMDDHHmm");
  var hostName = utils.getHostName();
  var piNumber = hostName[hostName.length-1];

  var pi = {
    hardware: getHardwareInfo(),
    diskUsage: getDiskUsage(),
    memoryUsage: getMemoryUsage(),
    swapping: getSwapping(),
    averageLoad: getAverageLoad(),
    underVoltage: getLatestUnderVoltage()
  };
  var kodi = getKodiStats();
  var ufw = getUfwStats();
  var router = getRouterStats();

  var piStatus = {
    message_datetime: runDate,
    pi:{
      hardware: pi.hardware,
      disk_internal: pi.diskUsage.internal,
      memory_internal: pi.memoryUsage.internal,
      memory_swap: pi.memoryUsage.swap,
      swapping_in: pi.swapping.in,
      swapping_out: pi.swapping.out,
      load_one_min: pi.averageLoad.oneMin,
      load_five_min: pi.averageLoad.fiveMin,
      load_fifteen_min: pi.averageLoad.fifteenMin,
      under_voltage: {
        date: pi.underVoltage != null ? pi.underVoltage.date.format("YYYYMMDDHHmm") : null,
        duration_sec: pi.underVoltage != null ? pi.underVoltage.durationSeconds : null
      }
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
    var piDailyStats = utils.readExistingJsonFile(path.join(__dirname, "pi-daily-stats.json"));
    logger.verbose(format("DAILY STATS: {0}; {1}; {2}",
      `Run=${piDailyStats.runDate}`,
      `NC: DB=${piDailyStats.nextCloudDbSizeMb}mb, Latest Ver=${piDailyStats.nextCloudLatestVersion}, SSL Cert: Expires=${piDailyStats.sslCertificateDaysUntilExpires}`,
      `NC NOTES: #=${piDailyStats.nextCloudNotesNumberOf}, Last Bkp=${piDailyStats.nextCloudNotesLastBackup}, Brian Note Id=${piDailyStats.nextCloudNoteBrianNoteId}`));
 
    var nextCloudStats = getNextCloudStats();
    var nextCloudNotesStats = getNextCloudNotesStats(piDailyStats.nextCloudNoteBrianNoteId);

    piStatus.nextcloud = {
      status: nextCloudStats.upDown,
      db_size: piDailyStats.nextCloudDbSizeMb,
      current_version: nextCloudStats.myVersion[0],
      latest_version: piDailyStats.nextCloudLatestVersion,
      ssl_cert_expiry: piDailyStats.sslCertificateDaysUntilExpires,
      last_backup: piDailyStats.nextCloudLastBackup
    };
    piStatus.nextcloud_notes = {
      status: nextCloudNotesStats.upDown,
      last_backup: piDailyStats.nextCloudNotesLastBackup
    };
  }

  var latestUnderVoltageEvent = "";
  if (pi.underVoltage != null) {
    latestUnderVoltageEvent = pi.underVoltage.date.format("M/D h:mm a");
    if (pi.underVoltage.durationSeconds != null)
      latestUnderVoltageEvent += " " + pi.underVoltage.durationSeconds + " seconds";
  }
  logger.info(format("PI: {0}; {1}; {2}; {3}; {4}; {5}",
    `Hardware: ${pi.hardware}`,
    `Disk: i=${pi.diskUsage.internal}%`,
    `Memory: i=${pi.memoryUsage.internal}%, s=${pi.memoryUsage.swap}%`,
    `Swap: in=${pi.swapping.in}, out=${pi.swapping.out}`,
    `Load: 1m=${pi.averageLoad.oneMin}, 5m=${pi.averageLoad.fiveMin}, 15m=${pi.averageLoad.fifteenMin}`),
    `Under Voltage: ${latestUnderVoltageEvent}`);
  logger.info(`KODI: ${kodi.status}, Versions=${kodi.currentVersion}/${kodi.latestVersion}`);
  logger.info(`UFW: ${ufw.status}`);
  logger.info(format("ROUTER: {0}; {1}; {2}",
    `${router.currentVersion}, up ${router.uptime}`,
    `Load: 1m=${router.averageLoad.oneMin}, 5m=${router.averageLoad.fiveMin}, 15m=${router.averageLoad.fifteenMin}`,
    `NAS=${router.nasStorage}%`));
  if (utils.nextCloudIsInstalled()) {
    logger.info(format("NEXTCLOUD: {0}",
      `${nextCloudStats.upDown}, DB=${piDailyStats.nextCloudDbSizeMb} mb, Versions=${nextCloudStats.myVersion}/${piDailyStats.nextCloudLatestVersion}, SSL=${piDailyStats.sslCertificateDaysUntilExpires} days, Bkp=${piDailyStats.nextCloudLastBackup}`));
    logger.info(format("NEXTCLOUD NOTES: {0}",
      `Notes: ${nextCloudNotesStats.upDown}, #=${piDailyStats.nextCloudNotesNumberOf}, Bkp=${piDailyStats.nextCloudNotesLastBackup}`));
  }

  piStatusMsg = `pi_${piNumber}_status_new|${JSON.stringify(piStatus)}`;
  utils.sendMessageToPhone(utils.configuration.family["brian"], piStatusMsg);
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
  var availableInternal = 0;

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
    // Get status of Kodi
    cmd = "curl --silent http://localhost:8080";
    var kodiWebPage = utils.executeShellCommand(cmd);
    status = kodiWebPage != "" ? "up" : "down";

    // Is something playing right now?
    cmd = "curl --silent --header 'Content-Type: application/json' --data-binary '{\"jsonrpc\": \"2.0\", \"method\": \"Player.GetActivePlayers\", \"id\": 1}' http://localhost:8080/jsonrpc";
    var kodiActivePlayers = utils.executeShellCommand(cmd);
    status += kodiActivePlayers.match(/playerid/i) ? " (playing)" : "";
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
      upDown = "down";
    }
  }
  
  return {
    upDown: upDown
  };
}


function getHardwareInfo() {
  // Using the linux TR command to trim out non-ascii characters, since it adds a unicode character at the end
  return hardwareInfo = utils
    .executeShellCommand("cat /proc/device-tree/model | tr -cd '\40-\176'")
    .replace(/Raspberry Pi\s/, "")
    .replace(/\sModel\s/, "")
    .replace(/\sPlus/, "+")
    .replace(/Rev\s/, "v");
}
         

function getLatestUnderVoltage() {
  //cat /var/log/syslog.1 /var/log/syslog | grep -i voltage 
  //  Apr  8 19:38:09 kummer-pi-1 kernel: [28063.402262] Under-voltage detected! (0x00050005)
  //  Apr  8 19:38:14 kummer-pi-1 kernel: [28067.562235] Voltage normalised (0x00000000)

  //var lines = utils.executeShellCommand("cat /var/log/syslog.1 /var/log/syslog | grep -i voltage");
  var lines = utils
    .executeShellCommand(format("( {0}; {1}; ) | {2}",
      "zcat /var/log/syslog.4 /var/log/syslog.3 /var/log/syslog.2",
      "cat /var/log/syslog.1 /var/log/syslog",
      "grep -i voltage"));
  var events = (lines == undefined ? [] : lines.split("\n"));

  var latestUnderVoltageEvent = null;

  if (events.length > 0) {
    var lastLine = events[events.length-1];
    var detectedEventLine = null;
    var normalizedEventLine = null;

    if (lastLine.includes("detected")) {
      // Last line is "detected", so we're still under voltage and there is no "normalised" event
      detectedEventLine = lastLine; 
    }
    else {
      // Last line is not "detected", so is "normalised", and we have both the detected and normalised events
      detectedEventLine = events[events.length - 2];
      normalizedEventLine = lastLine;
    }
    latestUnderVoltageEvent = {
      date:  moment(detectedEventLine.substring(0,15).trim(), "MMM D HH:mm:ss"),
      durationSeconds: null
    };
    if (normalizedEventLine != null) {
      var normalizedDateTime = moment(normalizedEventLine.substring(0,15).trim(), "MMM D HH:mm:ss");
      latestUnderVoltageEvent.durationSeconds = moment.duration(normalizedDateTime.diff(latestUnderVoltageEvent.date)).asSeconds();
    }
  }

  return latestUnderVoltageEvent;
}
