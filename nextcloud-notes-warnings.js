// NextCloud Notes Warnings
// September 2017
//
// Determine if each NextCloud-using family member has any possible duplicate notes,
// and if they do, email them a list of those possible duplicates
//
// Command-Line Parameters
// -----------------------
// Syntax:     node nextcloud-notes-duplicates.js [loglevel]
// Parameters: loglevel...Is optional. Determines the loglevel used:
//                        error|warn|info|verbose (default is "error")
//
// However, this script is configured via a number of environment variables,
// and one way of executing it is as follows:
//   sh -ac '. ./kummer-pi.env; node nextcloud-notes-warning.js verbose'
//
//
// Required NPM Packages
// ---------------------
// - Node fetch......Implements fetch for getting notes
//                   npm install node-fetch
// - Wuzzy...........Calculates similarity between notes (strings) using
//                   Levenshtein distance algorithm
//                   npm install wuzzy
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
var fs = require("fs");
var format = require("string-format");
var logger = require("winston");
var fetch = require("node-fetch");
var wuzzy = require("wuzzy");
var mysql = require("promise-mysql");
var path = require("path");
var utils = require(path.join(__dirname, "kummer-utils.js"));

utils.configureLogger(logger, __filename);

// Define an uncaughtException error handler to log if something really bad happens
function uncaughtExceptionHandler(options, err) {
  logger.error("%s", err.stack);
}
process.on("uncaughtException", uncaughtExceptionHandler.bind(null, {exit:true}));



logger.info("------------------------------------------------------------");
  if (utils.isRunningOnWindows)
    throw new Error("This script -= MUST =- be run on the Pi");

  findDuplicatesForAllUsers();
return;


function findDuplicatesForAllUsers() {
  // Only search for duplicates for family members who have a NextCloud password and an email address
  var url = utils.configuration.nextcloud.notes.base.url + "/notes";
  var authorization = "";

  // THIS LOOKS LIKE -GREAT- explanation of promises
  // http://solutionoptimist.com/2013/12/27/javascript-promise-chains-2/

  utils
    .configuration
    .family
    .allMembers
    .filter(fm => fm.hasOwnProperty("nextcloud") && fm.nextcloud.scripts.password != null && fm.email != null)
    .forEach(fm => {
      logger.verbose("%s --> Getting all notes", fm.name);
      authorization =
        "Basic " +
        new Buffer(format("{0}:{1}", fm.name, fm.nextcloud.scripts.password)).toString("base64");

      fetch(url, {
        method: "get",
        headers: {
          "Authorization": authorization,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      })
      .then(r => r.json())
      .then(notes => findDuplicateNotesForOneUser(fm, notes));
    });
}


function findDuplicateNotesForOneUser(familyMember, notes) {
// Loop through all notes, looking for duplicates

// DOCUMENTATION!!!!!
//
// Explanation of logic, which includes optimization. Assume list of notes is
//   id=1, content=ABC
//   id=2, content=DEF
//   id=3, content=GHI
//   id=4, content=HIJ
//   id=5, content=KLM
//   id=6, content=NOP
// Start by looping through the array
//   - First iteration (id=1, content=ABC)
//      - Loop through the array again, comparing
//  xxxxxx DETAILS - why set id = 'skip'
// OPTIMIZATION: remove matches from arrays. so...
//   - every time you're done with outer loop, remove it from what you'll search in inner loop.
//   - every time fine a dupe in inner loop, remove it from inner and outer loop
// BEWARE modifying the loop as we iterate through it !!!!!   --THINK!!!--
// INSTEAD OF DELETING, JUST SET id = 'skip' AND CHECK FOR THAT!!!!
// Wuzzy Levenshtein: range is 0-1, higher # is closer match, perfect match = 1
//
  logger.info("%s --> Searching for duplicate notes", familyMember.name);

  var connection = null;

  mysql.createConnection({
    host: "localhost",
    user: utils.configuration.nextcloud.db.username,
    password: utils.configuration.nextcloud.db.password,
    port: utils.configuration.nextcloud.db.port,
    database: "kummer"
  }).then((conn) => {
    connection = conn;
    return connection.query("SELECT * FROM find_duplicate_notes");
  }).then((rows) => {
    var emailMessage = "";
    var isDuplicate = false;
    var matchingRow = null;
    var distanceCalculated = null;
    var distanceTitle = 0
    var distanceContent = 0;
    var matching = "";

    // Sort notes by id, so that noteLookingForDupesOf.id is always < noteToCompareTo.id,
    // because the primary key to table find_duplicate_notes is noteLookingForDupesOf.id + noteToCompareTo.id,
    notes.sort((a,b) => a.id - b.id);

    notes.forEach(noteLookingForDupesOf => {
      if (noteLookingForDupesOf.id !== "skip") {
        logger.verbose("  %s #%s: %s...", rPad(isNull(noteLookingForDupesOf.category, "(no category)"), 15), noteLookingForDupesOf.id, noteLookingForDupesOf.title);

        // Compare noteLookingForDupesOf with every note, looking for duplicates
        notes.forEach(noteToCompareTo => {
          if (compareTheseNotes(familyMember.name, noteLookingForDupesOf, noteToCompareTo)) {
            matchingRow = rows.find(r => r.note_a_id === noteLookingForDupesOf.id && r.note_b_id === noteToCompareTo.id);
            distanceCalculated = moment().format("X")

            if (matchingRow == null) {
              // No existing database record found
              matching = rPad("None", 7);
              updateDistances(connection, noteLookingForDupesOf, noteToCompareTo, distanceCalculated, distanceTitle, distanceContent);

            } else if (noteLookingForDupesOf.modified > matchingRow.distance_calculated
              || noteToCompareTo.modified > matchingRow.distance_calculated) {
              // One of the notes changed since the last time we compared
              matching = rPad("Old", 7);

              logger.verbose("       OLD!!  A.mod=%s, db=%s, A.mod=%s", noteLookingForDupesOf.modified, matchingRow.distance_calculated, noteToCompareTo.modified );

              updateDistances(connection, noteLookingForDupesOf, noteToCompareTo, distanceCalculated, distanceTitle, distanceContent);

            } else {
              // We already have this in the database, and nothing has 
              // changed since the databse entry was created
              matching = rPad("Current", 7);
              distanceTitle = matchingRow.distance_title;
              distanceContent = matchingRow.distance_content;
            };

            logger.verbose("      (%s %s/%s)",
              matching, distanceTitle.toFixed(3), distanceContent.toFixed(3));

            if ((distanceTitle > 0.90) || (distanceContent > 0.90)) {
              isDuplicate = true;

              // There are some things that I don't want to be thought of as dupes
              //   - In the same category/subfolder, "Job Performance 2016" & "Job Performance 2017"
              if (
                (noteLookingForDupesOf.category == noteToCompareTo.category || (noteLookingForDupesOf.category+noteToCompareTo.category).match(/archive/i)) &&
                (noteLookingForDupesOf.title.replace(/20\d\d/g).trim() == noteToCompareTo.title.replace(/20\d\d/g).trim()))
                isDuplicate = false;

              if (isDuplicate) {
                logger.info("      Possible duplicate notes (%s/%s)", distanceTitle.toFixed(3), distanceContent.toFixed(3));
                logger.info("        %s %s", rPad(isNull(noteLookingForDupesOf.category, "(no category)"), 15), noteLookingForDupesOf.title);
                logger.info("        %s %s", rPad(isNull(noteToCompareTo.category, "(no category)"), 15), noteToCompareTo.title);

                noteToCompareTo.id = "skip";

                // Add this possible dupe to what we want to email the user
                emailMessage += format(
                  "\n{0} - {1}\n{2} - {3}\n",
                  isNull(noteLookingForDupesOf.category, "(no category)"), noteLookingForDupesOf.title, isNull(noteToCompareTo.category, "(no category)"), noteToCompareTo.title);
              }
            }
          }
        });
        noteLookingForDupesOf.id = "skip";   // Don't look at this note again
      }
    });
		 
    if (emailMessage.length > 0) {
      // We have some dupes to tell the user about
      emailMessage =
        format("{0},\n\nThese notes could be duplicates:\n{1}", familyMember.name, emailMessage);

      utils.sendGmail(utils.configuration.pi.gmail.username, 
        utils.configuration.pi.gmail.password,
        format('"{0}" <{1}>', "Kummer Cloud", utils.configuration.pi.gmail.username),
        format('"{0} {1}" <{2}>', familyMember.name, "Kummer", familyMember.email),
        "NextCloud Notes - Possible duplicates", emailMessage, null);
    }

    return null;
  }).then(results => {
    // It is not efficient to run this same command for each user, but I am too
    // lazy to figure out how to get the main loop to finish all promises before
    // executing this.
    logger.verbose("%s --> Deleting all old records", familyMember.name);
    deleteOldRecords();
  }).then(results => {
    logger.info("%s --> Done, closing connection", familyMember.name);
    connection.end();
  }).catch((error) => {
    if (connection && connection.end) connection.end();
    logger.error(error);
  });
}


function deleteOldRecords() {
    // TODO- Delete old records from find_duplicate_notes. Could likely
    // join to oc_filecache...
    // THIS is what I want, but this only deletes records AFTER file is deleted AND trash is emptied
    // (Otherwise, files are listed in oc_files_trash)
    // SELECT fdn.note_a_id, fdn.note_b_id, fca.fileid, fcb.fileid
    //   FROM kummer.find_duplicate_notes fdn
    //        LEFT JOIN nextcloud.oc_filecache fca ON nca.fileid = fdn.note_a_id
    //        LEFT JOIN nextcloud.oc_filecache fcb ON ncb.fileid = fdn.note_b_id
    //  WHERE fca.fileid IS NULL OR fcb.fileid IS NULL;

    var sql =
      "DELETE fdn " +
      "  FROM kummer.find_duplicate_notes fdn " +
      "       LEFT JOIN nextcloud.oc_filecache fca ON fca.fileid = fdn.note_a_id " +
      "       LEFT JOIN nextcloud.oc_filecache fcb ON fcb.fileid = fdn.note_b_id " +
      " WHERE fca.fileid IS NULL OR fcb.fileid IS NULL;"

    mysql.createConnection({
      host: "localhost",
      user: utils.configuration.nextcloud.db.username,
      password: utils.configuration.nextcloud.db.password,
      port: utils.configuration.nextcloud.db.port,
      database: "kummer"
    }).then((conn) => {
      connection = conn;
      return connection.query(sql);
    }).then(results => {
      connection.end();
      return results;
    });
}


function compareTheseNotes(whoseNotes, noteA, noteB) {
  // Right now, I'm going to check everything for duplicates. If this becomes too slow,
  // then I'll have to optimize how I look for duplicates, such as:
  //   - Only looking for duplicates caused by sharing
  //      - brianPossibleDupes is true if this might be caused by my editing a note Jodi shared with me
  //      - jodiPossibleDupes is true if this might be caused by her editing a note I shared with her
  //   - Excluding specific categories, such as "=( WORK-SYNC )="

  var brianPossibleDupe = (whoseNotes == "Brian") &&
    ((noteA.category == null && isNull(noteB.category, '').match(/jodi/i) != null) ||
      noteB.category == null && isNull(noteA.category, '').match(/jodi/i) != null);

  var jodiPossibleDupe = (whoseNotes == "Jodi") &&
    ((noteA.category == null && isNull(noteB.category, '').match(/brian/i) != null) ||
      noteB.category == null && isNull(noteA.category, '').match(/Brian/i) != null);

  var result =  
    (noteA.id !== "skip") &&
    (noteB.id !== "skip") &&
    (noteA.id !== noteB.id) &&
    (!isNull(noteA.category, "").match(/WORK/)) &&
    (!isNull(noteB.category, "").match(/WORK/));
    // (brianPossibleDupe || jodiPossibleDupe);

  logger.verbose ("    Comparing to #%s:%s:%s => possible dupe B/J=%s/%s, COMPARE=%s", 
    noteB.id, noteB.category, noteB.title, brianPossibleDupe, jodiPossibleDupe, result);

  return result;
}


function updateDistances(connection, noteA, noteB, distanceCalculated, distanceTitle, distanceContent) {
  // UPSERT ROW (https://mariadb.com/kb/en/the-mariadb-library/insert-on-duplicate-key-update)
  //   - Primary key is note_a_id + note_b_id, and these -MUST- be in ascending order,
  //     which is achieved by sorting notes array  before processing
  distanceTitle = wuzzy.levenshtein(noteA.title, noteB.title);
  distanceContent = wuzzy.levenshtein(noteA.content, noteB.content);

  logger.verbose("      Writing to DB: %s + %s => %s / %s / %s", noteA.id, noteB.id, distanceCalculated, distanceTitle, distanceContent);
  var sql = 
    "INSERT INTO find_duplicate_notes " +
                "(note_a_id, note_b_id, distance_calculated, distance_title, distance_content) " +
           "VALUES (?, ?, ?, ?, ?) " +
           "ON DUPLICATE KEY UPDATE " +
             "distance_calculated = VALUES(distance_calculated), " +
             "distance_title      = VALUES(distance_title), " +
             "distance_content    = VALUES(distance_content)";
  connection.query(sql, [noteA.id, noteB.id, distanceCalculated, distanceTitle, distanceContent]);
}


function isNull(value, defaultValue) {
  return (value == null || value == "null") ? defaultValue : value;
}


function rPad(value, length, padChar) {
  return (value + isNull(padChar, " ").repeat(length)).slice(0, length);
}
