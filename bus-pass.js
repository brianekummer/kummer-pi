// Bus Pass
// ------------------
// This script logs into Port Authority's web site and gets the
// balances of my ConnectCards and forwards them to my phone.
//
//
// Command-Line Parameters
// -----------------------
// Syntax:     node bus-pass.js [loglevel] [browser]
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
// and one way of executing it (either on the Pi, or in Windows via Git Bash)
// is as follows:
//   sh -ac '. ./kummer-pi.env; node bus-pass.js verbose'
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


// ****** TO DO ********
//  1. Backup changes to kummer-pi.env, since I added credentials for buss pass

var webdriver = require("selenium-webdriver"),
    by = webdriver.By,
    until = webdriver.until;
var moment = require("moment");
var format = require("string-format");
var logger = require("winston");
var path = require("path");
var utils = require(path.join(__dirname, "kummer-utils.js"));

utils.configureLogger(logger, __filename);

var webPageElements = {
	loginPage: {
		loginButtonId: "LoginButton",
		emailId: "EMAIL",
		passwordId: "PASSWORD"
	},
	welcomePage: {
		manageCardsButtonId: "sectionNavigation:nav_listCards"
	},
	manageCardsPage: {
		cardsGridId: "cards",
	  cardNumberXpath: "//*[@id='cards_data']/tr[{0}]/td[1]/div/div[2]/span",
		showTransactionsButtonId: "showCardTransactionsButton",
		logoutButtonId: "sectionNavigation:nav_logout"
	},
	cardBalancesPage: {
		paginatorXpath: "//*[text()[contains(.,'({0} of ')]]",
		desiredTransactionsXpath: "//tr[contains(@class, 'ui-widget-content') and not (contains(@class, 'canceledTransaction'))]",
		nextPageButtonXpath: "//a[contains(@class, 'ui-paginator-next') and not (contains(@class, 'ui-state-disabled'))]",
		backButtonId: "backButton"
	}
};


// Define an uncaughtException error handler to log if something really bad happens
function uncaughtExceptionHandler(options, err) {
  logger.error("%s", err.stack);
}
process.on('uncaughtException', uncaughtExceptionHandler.bind(null, {exit:true}));



logger.info("------------------------------------------------------------");
  logger.verbose("STARTING");

  var _driver = utils.getWebDriver();

	_driver
	  .then(() => login())
		.then(() => welcomePage())
		.then(() => manageCardsPage())
		.then(message => sendBalancesToPhone(message))
		.then(() => logout())
		.then(() => quit());
return;


function getFormattedRunDate() {
  return utils.today.format("M/D");
}


function login() {
  _driver.get(utils.configuration.buspass.url);
  _driver
	  .wait(until.elementLocated(by.id(webPageElements.loginPage.loginButtonId)), 10000)
    .then(
      () => {
        _driver.findElement(by.id(webPageElements.loginPage.emailId)).sendKeys(utils.configuration.buspass.username);
        _driver.findElement(by.id(webPageElements.loginPage.passwordId)).sendKeys(utils.configuration.buspass.password);
        _driver.findElement(by.id(webPageElements.loginPage.loginButtonId)).click();
      },
      err => logger.error('Login error: %s', err)
		);
}


function welcomePage() {
  _driver
	  .wait(until.elementLocated(by.id(webPageElements.welcomePage.manageCardsButtonId)), 10000)
    .then(
      () => {
        _driver.findElement(by.id(webPageElements.welcomePage.manageCardsButtonId)).click();
      },
      err => logger.error('Welcome page error: %s', err)
		);
}


function manageCardsPage() {
	return new Promise((resolve, reject) => {
		var messageToPhone = format("bus_pass|{0}|{1}|", 
			moment().format("YYYYMMDDHHmmss"), 
			getFormattedRunDate());

		_driver
			.wait(until.elementLocated(by.id(webPageElements.manageCardsPage.cardsGridId)), 10000)
			.then(() => {
				return readTransactionsForCardByNumber(1); 
			})
			.then(cardData => {
				messageToPhone += cardData;
				_driver.wait(until.elementLocated(by.id(webPageElements.manageCardsPage.cardsGridId)), 10000);
			})
			.then(() => {
				return readTransactionsForCardByNumber(2); 
			})
			.then(cardData => {
				messageToPhone += format("|{0}|", cardData);
				
				resolve(messageToPhone);
			});
	});
}


function readTransactionsForCardByNumber(cardNumber) {
	return new Promise((resolve, reject) => {
		logger.verbose("IN readTransactionsForCardByNumber(%s)", cardNumber);
		
		var events = [];
			
		_driver.findElement(by.xpath(format(webPageElements.manageCardsPage.cardNumberXpath, cardNumber))).click();
		_driver
			.wait(until.elementLocated(by.id(webPageElements.manageCardsPage.showTransactionsButtonId)), 10000)
			.then(() => {
				utils.sleep(500);    // SOMETIMES bad things happen without this
				_driver.findElement(by.id(webPageElements.manageCardsPage.showTransactionsButtonId)).click();
				return readCardBalances(events, 1);
			})
			.then(cardData => {
				_driver.findElement(by.id(webPageElements.cardBalancesPage.backButtonId)).click();
				resolve(cardData);
			});
	});
}


function readCardBalances(events, pageNumber) {
	return new Promise((resolve, reject) => {
		logger.verbose("IN readCardBalances for page %s", pageNumber);

		var xpathToPaginator = format(webPageElements.cardBalancesPage.paginatorXpath, pageNumber);
		var searchStatus = { done: false };
		
		_driver
			.wait(until.elementLocated(by.xpath(xpathToPaginator)), 10000)
			.findElement(by.xpath(xpathToPaginator)).getText()
			.then(pageXofY => {
				logger.verbose("  %s", pageXofY);
				
				// Search for the transactions we want on this page, excluding canceled, invalid,
				// and failed transactions, which all have the CSS class "canceledTransaction"
				return _driver.findElements(by.xpath(webPageElements.cardBalancesPage.desiredTransactionsXpath));
			})
			.then(rows => {
				// Parse the rows of data on this page
				
				return new Promise((resolve, reject) => {
					rows.map(row => row.getText().then(rowText => parseRow(rowText, events, searchStatus)));
					resolve("");
				});
			})
			.then(() => {	
				if (searchStatus.done) {
					// Found my most recent purchase, so there is no need to continue
					// searching through transactions
					return _driver.findElement(by.xpath("//[id='GARBAGE!']"));
				} else {
					// Look for the "next page" button
					return _driver.findElement(by.xpath(webPageElements.cardBalancesPage.nextPageButtonXpath));
				}
			})
			.then(
				nextPaginator => {
					// There is a next page button, so click it and then read the next page
					nextPaginator.click();
					_driver.then(() => resolve(readCardBalances(events, pageNumber+1)));
				},
				err => {
					// There is no next page button, so we're done
					resolve(calculatePhoneMessage(events));
			});
	});	
}


function parseRow(rowText, events, searchStatus) {
	/*
	  Monthly
			 Buy - mm/dd/yy hh:MM AM/PM | xxxxx | issue a new card xxx        | $128.00 | xxx Monthly Pass xxx
			 Use - mm/dd/yy hh:MM AM/PM | xxxxx | Validation or deduction xxx | $0.00   | xxx Monthly Pass xxx
		10 trip
		   Buy - mm/dd/yy hh:MM AM/PM | xxxxx | issue a new card xxx        | $36.00  | xxx 10 Trip xxx
			 Use - mm/dd/yy hh:MM AM/PM | xxxxx | Validation or deduction xxx | $0.00   | xxx 10 Trip xxx
  */
	var eventInfo = {
	  dateTime: moment(rowText.substr(0,16), "MM/DD/YY hh:mm A"),
	  action:   rowText.match(/issue a new card/i) ? "purchased" :
	            rowText.match(/deduction/i) ? "used" :
		          null,
	  passType: rowText.match(/monthly pass/i) ? "monthly" :
	            rowText.match(/10 trip/i) ? "10 trip" :
		          null
	};
	
	if (eventInfo.action != null && eventInfo.passType != null && !searchStatus.done) {
    logger.verbose("    %s %s pass @ %s", eventInfo.action[0].toUpperCase() + eventInfo.action.substring(1), eventInfo.passType, eventInfo.dateTime.format("MM/DD/YYYY hh:mm A"));
		events.push(eventInfo);

		// Found our most recent purchasing event, so no need to keep looking
		if (eventInfo.action == "purchased") {
		  searchStatus.done = true;
		}
  } else if (searchStatus.done) {
		logger.verbose("    >>> DONE, so skipping event: %s", rowText);
	} else {
    logger.verbose("    >>> No useful event: %s", rowText);
	}
}


function calculatePhoneMessage(events) {
	var cardData = "";
	var latestPurchase = events[events.length-1];

  switch(latestPurchase.passType) {
	  case "monthly":
			var passForMonth = null;
			if (latestPurchase.dateTime.date() > 7) {
				// Pass was purchased for the next month
				passForMonth = latestPurchase.dateTime.add(1, "month");
			} else {
				// Pass was purchased for the month it was purchased in
				passForMonth = latestPurchase.dateTime;
			}
			cardData = (moment() < passForMonth.endOf("month")) 
				? passForMonth.format("MMM")
				: null;
		  break;
		case "10 trip":
			var numTripsUsed = events.filter(e => e.action === "used" && e.passType === "10 trip").length;
			var numTripsRemaining = 10 - numTripsUsed;
			
			cardData = numTripsRemaining + " left";
		  break;
	}

	logger.verbose("CALC CARD DATA- %s", cardData);
	return cardData;
}


function sendBalancesToPhone(message) {
	logger.verbose("WIll send this to my phone: %s", message);
	
  //_driver
  //  .then(() => {
  //    utils.sendMessageToPhone(utils.configuration.family["brian"], message);
  //    logger.info("SENT bus pass balances to %s: %s", "Brian", message);
  //  });
}


function logout() {
  logger.verbose("  IN logOut");

  _driver
	  .wait(until.elementLocated(by.id(webPageElements.manageCardsPage.logoutButtonId)), 10000)
    .then(
      () => {
        _driver.findElement(by.id(webPageElements.manageCardsPage.logoutButtonId)).click();
      },
      err => logger.error('IN logout - ERROR: %s', err));
}


function quit() {
  logger.verbose("  IN quit");

  _driver
	  _driver.wait(until.elementLocated(by.id(webPageElements.loginPage.loginButtonId)), 10000)
    .then(
      () => {
        _driver.quit();
      },
      err => logger.error('IN quit - ERROR: %s', err));
}