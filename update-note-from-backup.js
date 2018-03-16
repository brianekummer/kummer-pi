// Update a note from backup
// August 2017
//
// Take as input a note id and the name of a note daily backup file and 
// apply the note from the backup
//  - If the note does not exist (e.g. was created after the last full backup),
//    it will be created with a different id


var moment = require("moment");
var fs = require("fs");
var format = require("string-format");
var path = require("path");
var utils = require(path.join(__dirname, "kummer-utils.js"));
var fetch = require('node-fetch');


if (utils.isRunningOnWindows)
  throw new Error("This script -= MUST =- be run on the Pi");


var noteId = process.argv[2]
var notesFileName = process.argv[3];

var backupNotes = JSON.parse(fs.readFileSync(notesFileName, "utf8"));
var changedNote = backupNotes.filter(n => n.id == noteId)[0];

delete changedNote.id;

var url = format("{0}/notes/{1}", utils.configuration.nextcloud.notes.base.url, changedNote.id);
var brian = utils.configuration.family.allMembers.filter(fm => fm.name === "Brian")[0];
var authorization =
      'Basic ' +
      new Buffer(format("{0}:{1}",
        brian.name,
        brian.nextcloud.scripts.password))
      .toString('base64');
			
fetch(url, {
  method: 'PUT',
  headers: {
    'Authorization': authorization,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(changedNote) 
})
.then(response => {
  console.log("UPDATE- Status = " + response.status + " " + response.statusText);
	
  if (response.status == 404 || response.status == 405)
  {
    // This note doesn't exist, so we need to create it
    console.log("Error UPDATING, so must CREATE");
    url = format("{0}/notes", utils.configuration.nextcloud.notes.base.url);
    createNewNote(url, authorization, changedNote);
  }
	
  return response.json().then(data => {
    if (response.ok) {
      console.log("OK!!");
      return data;
    } else {
      return Promise.reject({status: response.status, data});
    }
  });
})
.then(result => console.log('UPDATE- Success:', result))
.catch(error => console.log('UPDATE- Error:', error));

return;





function createNewNote(url, authorization, newNote) {
  fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authorization,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(newNote) 
})
.then(response => {
  console.log("CREATE- Status = " + response.status + " " + response.statusText);
	
  return response.json().then(data => {
    if (response.ok) {
      return data;
    } else {
      return Promise.reject({status: response.status, data});
    }
  });
})
.then(result => console.log('CREATE- Success:', result))
.catch(error => console.log('CREATE- Error:', error));
