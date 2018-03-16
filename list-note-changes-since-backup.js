// List notes that have changes since a given backup
// August 2017
//
// Take as input a date (yyyy-mm-dd) and the name of a note daily backup file and list
// all the notes in that backup that are newer than that date
			
var moment = require("moment");
var fs = require("fs");
var format = require("string-format");
var utils = require(SCRIPT_PATH + "kummer-utils.js");



if (utils.isRunningOnWindows)
  throw new Error("This script -= MUST =- be run on the Pi");



var startDate = moment(process.argv[2], "YYYY-MM-DD");
var notesFileName = process.argv[3];

var allNotes = JSON.parse(fs.readFileSync(notesFileName, "utf8"));

for (var i = 0, len=allNotes.length; i < len; i++) {
  var n = allNotes[i];
    if (moment(Number(n.modified), "X").isAfter(startDate)) {
      console.log("ID:" + n.id + ", Modified:" + moment(Number(n.modified), "X").format("YYYY-MM-DD") + ", " + n.title);
    }
}

return;
