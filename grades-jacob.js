// Grades - Jacob
// ------------------
// This script queries the school's website to get Jacob's grades,
// then forward those to his and my phone.
// Ported to JavaScript to run on my Raspberry Pi January 2017
//
//
// Command-Line Parameters
// -----------------------
// Syntax:     node grades-jacob.js [loglevel] [browser]
// Parameters: loglevel...Is optional. Determines the loglevel used:
//                        error|warn|info|verbose (default is "error")
//             browser....Is optional. Which browser to use: default|chrome|phantomjs
//                        default.....If running on Windows, defaults to Chrome
//                                    If running on linux, defaults to PhantomJS
//                        chrome......Use Chrome. I have been unable to get Chrome
//                                    working on my Pi.
//                        phantomjs...Use PhantomJS
//
// However, this script is configured via a number of environment variables,
// and one way of executing it is as follows:
//   sh -ac '. ./kummer-pi.env; node grades-jacob.js verbose'
//
//
// Selenium and Asynchronous Code
// ------------------------------
// Selenium webdrivers for other languages like .NET are
// synchronous, but JavaScript's are not, so you have lots
// of JavaScript promises to handle the asynchronous events.
// This provides a good sample to understand this:
//   https://code.tutsplus.com/tutorials/an-introduction-to-webdriver-using-the-javascript-bindings--cms-21855
//
//
// Required NPM Packages
// ---------------------
// - Selenium........For scraping web pages
//                   npm install selenium-webdriver
// - MomentJS........For date logic
//                   npm install moment
// - File system.....For reading/writing files
//                   npm install file-system
// - String format...To simplify formatting strings in JavaScript
//                   npm install string-format
// - Winston.........A logging framework
//                   npm install winston
// - Ical............To simplify handling of ical files
//                   npm install ical
//
// Other Required Components
// -------------------------
// - PhantomJS
//     - For Raspberry Pi
//        - Stored in selenium-drivers-pi
//        - The version of PhantomJS from dropbox at this site works for me
//           http://www.it1me.com/it-answers?id=36314771&ttl=How+to+install+PhantomJS+for+use+with+Python+Selenium+on+the+Raspberry+Pi%3F
//     - For Win32
//        - Stored in selenium-drivers-win32


var webdriver = require("selenium-webdriver"),
    by = webdriver.By,
    until = webdriver.until;
var moment = require("moment");
var fs = require("fs");
var format = require("string-format");
var logger = require("winston");
var ical = require("ical");
var path = require("path");
var utils = require(path.join(__dirname, "kummer-utils.js"));

utils.configureLogger(logger, __filename);

// Define an uncaughtException error handler to log if something really bad happens
function uncaughtExceptionHandler(options, err) {
  logger.error("%s", err.stack);
}
process.on('uncaughtException', uncaughtExceptionHandler.bind(null, {exit:true}));



logger.info("------------------------------------------------------------");
  logger.verbose("STARTING");

  var _driver = utils.getWebDriver();
  var _tempData = null;

  _driver
    .then(() => getEndOfTerm());

return;


function getFormattedRunDate() {
  return utils.today.format("M/D");
}


//region Use School Calendar to Get End-of-Term Info


function getEndOfTerm() {
  // Look at the school's calendar for end of current 9 weeks
  // to calculate end date of current 9 weeks and how many
  // class days are left before then
  //
  // This code ASSUMES that dates are ordered ascending !
  logger.verbose("IN getEndOfTerm");

  ical.fromURL(utils.configuration.school.calendar.url, {}, (err, data) => {
    logger.verbose("IN getEndOfTerm - Got calendar data");

    _driver.then(() => {
      var termNumber = null;
      var termEndDate = null;
      var termDaysLeft = 0;
      var noSchoolDates = [];

      for (var k in data) {
        var eventStart = moment(data[k].start);
        var eventSummary = data[k].summary;

        // We only care about all day events (in 2017, they are not all-day events)
        //if (eventStart.format("HHmmss") == "000000") {
          if (eventSummary.match(/end of.*term/i)) {
            termNumber = eventSummary.match(/\d/)[0];

            if (utils.today <= eventStart) {
              termEndDate = eventStart;

              // Count number of class days left by looping from tomorrow to the end of the term,
              // and counting days that are not Saturday, Sunday, or No-School-Days.
              for (var m = moment(utils.tomorrow); m.diff(termEndDate, "days") <= 0; m.add(1, "days")) {
                if (m.weekday() != 6 && m.weekday() != 0 && !noSchoolDates.includes(m.format("MM-DD-YYYY"))) {
                  termDaysLeft ++;
                }
              }

              break;
            }
          } else if (eventSummary.match(/(in.?service|clerical|no school|act 80|labor day|memorial day|recess|break)/i)) {
            noSchoolDates.push(eventStart.format("MM-DD-YYYY"));
          }
        //}
      }

      _tempData = {
        TermNumber: termNumber,
        TermDaysLeft: termDaysLeft,
        TermEndDate: termEndDate,
        Grades: []
      };

      logger.verbose("IN getEndOfTerm - Term %s ends in %s day%s on %s", termNumber, termDaysLeft, (termDaysLeft == 1 ? "" : "s"), termEndDate.format("YYYY-MM-DD"));
    })
    .then(() => getGrades())
    .then(() => sendGradesToPhones())
    .then(() => utils.webDriverQuit(_driver));

  });
}


//endregion


//region Get Grades


function getGrades() {
  logger.verbose("IN getGrades");

  _driver.get(utils.configuration.school.grades.url);
  _driver.wait(until.elementLocated(by.id("login")), 10000)   // Timeout very unlikely here
    .then(
      () => {
        utils.sleep(500);
        _driver.findElement(by.id("login")).sendKeys(utils.configuration.school.grades.username);
        _driver.findElement(by.id("password")).sendKeys(utils.configuration.school.grades.password);
        _driver.findElement(by.id("bLogin")).click();
        _driver.wait(until.elementLocated(by.id("classGradesDiv")), 30000)
        .then(() => getPeriods())
        .then(() => logOut());
      },
      err => logger.error('IN getGrades - ERROR: %s', err));
}


function logOut() {
  logger.verbose("  IN logOut");

  // The logout link/button is hidden, and to make it visible, we have to click
  // multiple buttons- it's involved. Since Selenium can't click on invisible
  // objects, we'll just click on it using JavaScript. This is kludgy and
  // not suitable for production code, but I'll do it anyway.
  _driver
    .findElement(by.xpath("//a[@data-screen='log_out']"))
    .then(
      element => _driver.executeScript("arguments[0].click();", element),
      err => logger.error("  IN logOut. Error finding logout button: %s", err));
}


function getPeriods() {
  logger.verbose("  IN getPeriods");

  utils.sleep(500);
  _driver
    // Count how many periods he has by counting the number of rows in the
    // body of the table
    .findElements(by.xpath("//table/tbody/tr"))
    .then((elements) => {
      // We now know there are elements.length periods, so go get the
      // name and grade for each one.
      if (elements.length < 5) {
        // Looks like there are not enough classes displayed, likely
        // due to changes bewteen semesters
        addClassAndGrade(1, " ", " ");
        addClassAndGrade(2, "ERROR", " ");
        addClassAndGrade(3, format("Only {0} rows", elements.length), " ");
      } else {
        var periodNumber = 0;
        elements.forEach(e => {
          periodNumber++;
          getClassNameAndGrade(periodNumber, e);
        });
      }
    });
}


function getClassNameAndGrade(periodNumber, classRow) {
  logger.verbose("    IN getPeriod(classRow=%s)", classRow);

  classRow
    .getText()
    .then(periodRowText => {
      logger.verbose("    Row Text=%s", periodRowText);
      var parts = periodRowText.split("\n");
      var className = parts[0];
      if (parts.length == 2) {
        // There is no grade for this class yet
        addClassAndGrade(periodNumber, className, " ");
      } else {
        addClassAndGrade(periodNumber, className, parts[2]);
      }
    });
}


function addClassAndGrade(periodNumber, className, grade) {
  var newClass = {
    Period: periodNumber,
    Name: className,
    Grade: grade
  };
  _tempData.Grades.push(newClass);
  logger.verbose("    Period %s: %s: %s", newClass.Period, newClass.Name, newClass.Grade);
}


function sendGradesToPhones() {
  var wasError = (_tempData.Grades.length == 0);
  logger.verbose("IN sendGradesToPhones. wasError=%s", wasError);

  // Android widgets ASSUME there are always 7 periods,
  // so make it so
  for (var i = _tempData.Grades.length; i < 7; i++) {
    addClassAndGrade(i+1, (wasError ? "ERR" : " "), (wasError ? "?" : " "));
  }

  // Change the class names to something more mobile friendly
  _tempData.Grades.forEach(g => {
    g.Name = g.Name
      .replace("COL ALG / TRIG", "Algebra")
      .replace("GRAPH TECH 3",   "Graphics")
      .replace("AP ECONOMICS",   "Economics")
      .replace("COL WRITING",    "Writing")
      .replace("PHOTOGRAPHY 2",  "Photo 2")
      .replace("PHYED 11/12A",   "PhysEd")
      .replace("PHYED 11/12B",   "PhysEd")
      .replace("CHEMISTRY",      "Chemistry");
  });

  var msg = format("jacob_grades|{0}|{1}|{2}|{3}|",
    getFormattedRunDate(),
    _tempData.Grades.map(g => g.Name + '|' + g.Grade).join('|'),
    _tempData.TermEndDate.format("M/D"),
    _tempData.TermDaysLeft);

  _driver
    .then(() => sendGradesToBrian(msg))
    .then(() => sendGradesToJacob(msg));
}


function sendGradesToBrian(msg) {
  _driver
    .then(() => {
      utils.sendMessageToPhone(utils.configuration.family["brian"], msg);
      logger.info("SENT grades to %s: %s", "Brian", msg);
    });
}


function sendGradesToJacob(msg) {
  _driver
    .then(() => {
      if (msg.match(/\|ERR\|\?\|/) == null) {
        // Only send message to Jacob if there's not an error
        utils.sendMessageToPhone(utils.configuration.family["jacob"], msg);
        logger.info("SENT grades to %s: %s", "Jacob", msg);
      } else {
        logger.error("NOT sending grades to Jacob because msg=%s", msg);
      }
    });
}


//endregion
