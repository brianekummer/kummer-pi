// Tracfone Balances
// ------------------
// This script queries TracFone for everyone's balances and
// sends those balances to our phones.
// Ported to JavaScript to run on my Raspberry Pi January 2017
//
//
// Command-Line Parameters
// -----------------------
// Syntax:     node grades-jacob.js [loglevel] [browser]
// Parameters: loglevel...Is optional. Which loglevel to use: error|warn|info|verbose
//                        Default is "error"
//             browser....Is optional. Which browser to use: default|chrome|phantomjs
//                        Defaults to "default"
//                        default.....If running on Windows, uses Chrome
//                                    If running on linux, uses PhantomJS
//                        chrome......Use Chrome. I have been unable to get Chrome
//                                    working on my Pi.
//                        phantomjs...Use PhantomJS
//
// However, this script is configured via a number of environment variables,
// and one way of executing it is as follows:
//   sh -ac '. ./kummer-pi.env; node tracfone.js verbose'
//
//
// Selenium and Asynchronous Code
// ------------------------------
// Selenium webdrivers for other languages like .NET are
// synchronous, but JavaScript's are not, so you have lots
// of JavaScript promises to handle the asynchronous events.
// This provides a good sample to understand this:
//   https://code.tutsplus.com/tutorials/an-introduction-to-webdriver-using-the-javascript-bindings--cms-21855
// If this becomes a problem, the following might be useful
//   https://www.npmjs.com/package/webdriver-sync
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
  var DATA_JSON = path.join(__dirname, "kummer-data.json");

  var _data = utils.readExistingJsonFile(DATA_JSON);
  var _driver = utils.getWebDriver();
  var _tempData = null;

  _driver
    .then(() => utils
      .configuration
      .family
      .allMembers
      .forEach(fm =>
        _driver.then(() => getBalances(fm, false))))
    //.then(() => loadPaymentHistory())
    .then(() => utils.saveJsonFile(DATA_JSON, _data))
    .then(() => sendToPhones())
    .then(() => utils.webDriverQuit(_driver));

return;


function getFormattedRunDate() {
  return utils.today.format("M/D");
}


function getFamilyMemberData(familyMemberName) {
  return _data.FamilyMembers.filter(fm => fm.Name.toLowerCase() == familyMemberName.toLowerCase())[0];
}


//region TracFone Calculations


function getStartOfCurrentBillingMonth() {
  // The date the current billing month started. For example, assuming
  // DayOfMonthGetRefills = 3:
  //   If today >= 3rd, billing month started on 3rd of the current month
  //   If today <  3rd, billing month started on 3rd of the previous month
  var startOfCurrentBillingMonth = utils
    .today
    .clone()
    .date(utils.configuration.tracfone.dayofmonthgetrefills)
    .add(utils.today.date() >= utils.configuration.tracfone.dayofmonthgetrefills ? 0: -1, "months");

  return startOfCurrentBillingMonth;
}


function getNumDaysUntilRefills() {
  // Calculate the number of days until we get refills. We want this
  // to be zero on the day we get refills.
  var numDays = 0;

  if (utils.today.date() == utils.configuration.tracfone.dayofmonthgetrefills) {
    numDays = 0;
  } else {
    numDays = getStartOfCurrentBillingMonth()
      .add(1, "months")
      .diff(utils.today, "days", true);
  }

  return numDays;
}


//endregion


//region Get Balances


function getBalances(familyMember, retrying) {
  logger.verbose("%s - IN getBalances(retrying=%s)", familyMember.name.toUpperCase(), retrying);

  var url = utils.configuration.tracfone.balances.url.replace("%PHONE_NUMBER%", familyMember.phone.number);

  if (!retrying) {
    _tempData = {
      FamilyMemberName: familyMember.name,
      Balances: {
        BalanceDate: moment(),
        Minutes: "DEFAULT",
        Texts: "DEFAULT",
        Mb: "DEFAULT"
      },
      StartDateTime: moment(),
      InProgress: true,
      OopsError: false,
      TimedOut: false,
      RetryCount: 0
    }
  } else {
    _tempData.InProgress = true;
    _tempData.OopsError = false;
    _tempData.TimedOut = false;
    _tempData.RetryCount ++;
  }

  _driver
    .get(url)
    .then(balancesPageInProgress, balancesPageTimedOut);
}


function balancesPageInProgress(value) {
  logger.verbose("  IN balancesPageInProgress");

  _driver
    .sleep(5000)
    .then(() => {
      _driver
        .wait(waitForInProgressToGoAway, 1000*utils.configuration.tracfone.balances.timeoutinseconds)
        .then(balancesPageLoaded, balancesPageTimedOut);
    });
}


function waitForInProgressToGoAway() {
  // Do NOT reformat this code- it appears to break when reformatted
  return _driver.findElements(by.className("blockPage")).then(matches => {
    return (matches == 0);
  });
}


function balancesPageLoaded() {
  balancesPageCommon(false);
}


function balancesPageTimedOut() {
  balancesPageCommon(true);
}


function balancesPageCommon(timedOut) {
  logger.verbose("  IN balancesPageCommon(timedOut=%s)", timedOut);

  _tempData.InProgress = false;
  _tempData.TimedOut = timedOut;

  _driver
    .then(getOopsError)
    .then(getMinutes)
    .then(getTexts)
    .then(getMb)
    .then(tellMeResults)
    .then(retryOrSave(utils.configuration.family[_tempData.FamilyMemberName.toLowerCase()]));
}


function retryOrSave(familyMember) {
  _driver.then(() => {
    var wasError = wasBalancesError(_tempData.Balances);
    logger.verbose("  IN retryOrSave(familyMember=%s) - wasError=%s RetryCount=%s %j",
      familyMember.name, wasError, _tempData.RetryCount, _tempData.Balances);

    if (wasError && _tempData.RetryCount < 2) {
      logger.warn("  IN retryOrSave - %s - Retry # %s", familyMember.name, (_tempData.RetryCount+1));
      getBalances(familyMember, true);
    } else {
      saveBalances();
    }
  });
}


function wasBalancesError(balances) {
  return (format("{0}{1}{2}", balances.Minutes, balances.Texts, balances.Mb).match(/[^\d\.]/i) != null);
}


function getOopsError() {
  logger.verbose("  IN getOopsError");

  _driver
    .findElements(by.className("oopsBody"))
    .then(elements => {
      _tempData.OopsError = (elements.length > 0);
      if (_tempData.OopsError) logger.verbose("    OOPS ERROR! elements.length=%s", elements.length);
    });
}


function getMinutes() {
  logger.verbose("  IN getMinutes");

  _driver
    .findElements(by.id("minutes"))
    .then(elements => extractBalance("Minutes", elements));
}


function getTexts() {
  logger.verbose("  IN getTexts");

  _driver
    .findElements(by.id("msg"))
    .then(elements => extractBalance("Texts", elements));
}


function getMb() {
  logger.verbose("  IN getMb");

  _driver
    .findElements(by.id("mb"))
    .then(elements => extractBalance("Mb", elements));
}


function extractBalance(balanceKey, elements) {
  // Extract the number from the specified field (minutes|msg|mb), and round it DOWN
  //   e  Some minor error ("oops" error or page timeout)
  //   E  Some major error, like there's a "Minutes" field but no value, such as when
  //      we've timed out but we still have SOME data, but some fields are blank (e.g. 
  //      "MB:")
  logger.verbose("    IN extractBalance(balanceKey=%s, elements.length=%s) Oops=%s TO=%s", balanceKey, elements.length, _tempData.OopsError, _tempData.TimedOut);

  try {
    elements[0]
      .getText()
      .then(
        labelAndValue => {
          try {
            // Round down (mainly for data/mb)
            _tempData.Balances[balanceKey] = Math.floor(labelAndValue.match(/\d*\.?\d+/)[0]);
          } catch (ex) {
            extractBalanceError(balanceKey, ex.message)
          }
        },
        err => extractBalanceError(balanceKey, err));
  } catch (ex) {
    extractBalanceError(balanceKey, ex.message);
  }
}


function extractBalanceError(balanceKey, msg) {
  if (_tempData.OopsError || _tempData.TimedOut) {
    // It's not a surprise that we had an error
    _tempData.Balances[balanceKey] = "e";
  } else {
    // Something bad that I didn't expect happened
    _tempData.Balances[balanceKey] = "E";
    logger.error("      IN extractBalanceError. ERROR: %s", msg);
  }
}


function saveBalances() {
  logger.verbose("  IN saveBalances");

  var familyMemberData = getFamilyMemberData(_tempData.FamilyMemberName);

  // This will insert an item into an array at the specified index (deleting 
  // 0 items first, that is, it's just an insert).
  familyMemberData.TracFoneBalances.splice(0, 0, _tempData.Balances);
}


function tellMeResults() {
  logger.verbose("  %s- WIP=%s Oops=%s TO=%s min=%s text=%s mb=%s",
    _tempData.FamilyMemberName.toUpperCase(),
    _tempData.InProgress,
    _tempData.OopsError,
    _tempData.TimedOut,
    _tempData.Balances.Minutes,
    _tempData.Balances.Texts,
    _tempData.Balances.Mb);
}


//endregion


//region Load Payment History


function loadPaymentHistory() {
  logger.verbose("IN loadPaymentHistory");

  _driver.get(utils.secrets.Credentials.TracFone.Url);
  _driver.findElement(by.id("email")).sendKeys(utils.configuration.tracfone.username);
  _driver.findElement(by.id("password")).sendKeys(utils.configuration.tracfone.password);
  _driver.findElement(by.id("login_form_button")).click();

  _driver.wait(until.elementLocated(by.xpath("//a[text()='Payment History']")), 30000)
    .then(
      element => element.click(),
      err => logger.error("IN loadPaymentHistory. ERROR searching for Payment History link: %s", err));
  _driver.wait(until.titleIs("Payment History"))
    .then(
      () => {
        _driver
          .findElement(by.className("pmt_history"))
          .getText()
          .then(gotPaymentHistory);
      },
      err => logger.error("IN loadPaymentHistory. ERROR waiting for Payment History page to load: %s", err));
}


function gotPaymentHistory(paymentHistoryText) {
  logger.verbose("  IN gotPaymentHistory");

  var lines = paymentHistoryText.split('\n');
  var transDate;
  var imei;
  var amount;
  var parts;
  lines.forEach(line => {
    if(line.match(/approved/i)) {
      // Ignore declined payments (e.g. I messed up entering credit card info)
      parts = line.split(' ');
      transDate = parts[0];
      imei = parts[2];
      amount = line.match(/\$\d+\.\d+/)[0].replace("$", "");
      if (amount != utils.configuration.tracfone.basemonthlyamount) {
        //TODO FINISH THIS!!!! This will likely not work...
        var purchaserName = utils.configuration.family.filter(fm => fm.phone.imei == imei)[0].ame;
        var purchaserData = getFamilyMemberData(purchaserName);

        var newPurchase = {
          PurchaseDate: transDate,
          Amount: amount
        };

        // Only add this purchase if we don't already have it
        if (!purchaserData.TracFonePurchases.some(
          (element, index, array) =>
          element.PurchaseDate == newPurchase.PurchaseDate && element.Amount == newPurchase.Amount))
        {
          // Insert this purchase into the array at position 0 and delete 0 elements
          purchaserData.TracFonePurchases.splice(0, 0, newPurchase);
        }
      }
    }
  });
}


function getSumOfExtraPurchasesSince(familyMemberData, startDate) {
  // Sum up all the extra purchases since startDate, excluding the usual base monthly amount
  var startDateFormatted = startDate.format("YYYY-MM-DD");
  var purchases = 
    familyMemberData
      .TracFonePurchases
      // Find the purchases we want
      .filter(purchase => purchase.Amount != utils.configuration.tracfone.basemonthlyamount && purchase.PurchaseDate >= startDateFormatted)
      // Return only the amount
      .map(a => Number(a.Amount));
  var sum = 0;
  if (purchases != null && purchases.length > 0) {
    sum = purchases.reduce((x, y) => x + y);
  }

  return sum;
}


function getAverageMonthlyBill(numberOfMonths) {
  // Calculate the start of the period we want
  var startDate = getStartOfCurrentBillingMonth().add(-(numberOfMonths - 1), "months");

  // Total purchases are:
  //   Base monthly bill * number of months
  //   plus
  //   Sum up each family member's extra purchases
  var totalPurchases = (numberOfMonths * utils.configuration.tracfone.basemonthlyamount);
  _data.FamilyMembers.forEach(fmd => totalPurchases += getSumOfExtraPurchasesSince(fmd, startDate));

  var average = Math.round(totalPurchases / numberOfMonths);

  return average;
}


//endregion


//region Send to Phones


function sendToPhones() {
  logger.verbose("IN sendToPhones");

  var brian = utils.configuration.family["brian"];
  var brianData = getFamilyMemberData("Brian");
  var jodi = utils.configuration.family["jodi"];
  var jodiData = getFamilyMemberData("Jodi");
  var jacob = utils.configuration.family["jacob"];
  var jacobData = getFamilyMemberData("Jacob");
  var kaley = utils.configuration.family["kaley"];
  var kaleyData = getFamilyMemberData("Kaley");
  var home = utils.configuration.family["home"];
  var homeData = getFamilyMemberData("Home");
  var pop = utils.configuration.family["pop"];
  var popData = getFamilyMemberData("Pop");

  _driver
    .then(() => sendAllBalancesToBrian(brian, [ brianData, jodiData, jacobData, kaleyData, homeData, popData ]))
    .then(() => sendSomeoneTheirBalances(jodi, jodiData))
    .then(() => sendSomeoneTheirBalances(jacob, jacobData))
    .then(() => sendSomeoneTheirBalances(kaley, kaleyData))
    .then(() => sendSomeoneTheirBalances(home, homeData))
    .then(() => sendSomeoneTheirBalances(pop, popData))

    // Because Jodi and Kaley sometimes have issues receiving their
    // balance, we also send their balances to my phone, so my phone
    // can forward their balances to them when they ask
    .then(() => utils.sendMessageToPhone(brian, format("tracfone_received_kaley_balances =:= {0}", fullPhoneMessage(kaleyData))))
    .then(() => utils.sendMessageToPhone(brian, format("tracfone_received_jodi_balances =:= {0}", fullPhoneMessage(jodiData))));
}


function shouldSendLatestBalancesToPhone(familyMemberData) {
  // Only send the latest balances to phone if there was no error and is from today
  var latest = familyMemberData.TracFoneBalances[0];
  var returnValue = !wasBalancesError(latest) && moment(latest.BalanceDate).isAfter(utils.today);

  return returnValue;
}


function partialPhoneMessage(familyMemberData) {
  var balances = familyMemberData.TracFoneBalances[0];

  var returnValue = format("{0}|{1}|{2}|{3}",
    familyMemberData.Name,
    balances.Minutes,
    balances.Texts,
    balances.Mb);

  return returnValue;
}


function fullPhoneMessage(familyMemberData) {
  var returnValue = format("tracfone_balances_me|{0}|{1}|{2}|",
    getFormattedRunDate(),
    getNumDaysUntilRefills(),
    partialPhoneMessage(familyMemberData));

  return returnValue;
}


function sendAllBalancesToBrian(brian, familyMembersData) {
  // My phone gets
  //   * Run date (M/d)
  //   * Number of days until refills
  //   * Balances for each family member, including myself (name|minutes|texts|mb)
  //   * Average monthly bill for past 3 months
  logger.verbose("IN sendAllBalancesToBrian");

  var msg = format("tracfone_balances_all|{0}|{1}|{2}|{3}|",
    getFormattedRunDate(), 
    getNumDaysUntilRefills(),
    familyMembersData.map(fmd => partialPhoneMessage(fmd)).join("|"),
    getAverageMonthlyBill(3));

  utils.sendMessageToPhone(brian, msg);
}


function sendSomeoneTheirBalances(familyMember, familyMemberData) {
  var msg = fullPhoneMessage(familyMemberData);
  if (familyMember.autoremotekey != null && shouldSendLatestBalancesToPhone(familyMemberData))
  {
    utils.sendMessageToPhone(familyMember, msg);
  } else {
    logger.info("NOT sending balances to %s: %s", familyMember.name, msg);
  }
}
