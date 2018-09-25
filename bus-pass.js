// Bus Pass
// ------------------
// This script logs into Port Authority's web site and gets the
// balances of my ConnectCards and forwards them to my phone
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

// Define an uncaughtException error handler to log if something really bad happens
function uncaughtExceptionHandler(options, err) {
  logger.error("%s", err.stack);
}
process.on('uncaughtException', uncaughtExceptionHandler.bind(null, {exit:true}));



logger.info("------------------------------------------------------------");
  logger.verbose("STARTING");

  var _driver = utils.getWebDriver();
  var _tempData = null;

	
/*
   general strategy:
	 - message to phone:
	   syntax: bus_pass|date_time|card_1_name|card_1_number_last_4_digits|card_1_result|card_2_name|card_2_number_last_4_digits|card_2_result|
	   example: bus_pass|20180610121811|Brian|...1234|JUNE|Brian #2|...4567|5 trips left|
		 
	 - init variables
	 - login()
	    - navigate to login page - https://manage.connectcard.org/selfservice/pages/public/loginIV.jsf
	       - wait for login page to load 
	       - enter user id, pwd (ids EMAIL and PASSWORD)
         - click login button (id LoginButton)
	 - welcomePage()
	    - wait for "welcome" page
	    - click option to list cards (id sectionNavigation:nav_listCards)
   - manageCardsPage()
		  - wait for "Manage cards" page
			- readTransactionsForCardByName(cardName) eg "Brian"
			   - search table rows for "Brian" (cards:0:cardAliasInput) and select radio button
         - Check radio button using   $x("//*[@id='cards_data']/tr[xxx]/td[1]/div/div[1]/input")[0].checked = true
   				 where xxx = 1 for 1st row (Brian #2 ...685), 2 for second row (Brian ...453)
         - Click "Balance/Transactions" button (id showCardTransactionsButton)
	       
				 - readCardBalances()
				    - wait for "Card Balance and Transaction History" page
				       - set list of transactions = []
				       - get total number of pages from "class=ui-paginator-current" (ie "(x of y)")
			         - for loop through all y pages "(x of y)"
				       - for each row in tbody //*[@id="dataTable_data"]
			            - read a line and append to array
			 	          - table row 
                     - col 1 = mm/dd/yyyy hh:mm AM/PM
                     - col 2 = bus id
                     - col 3 = action 
                     - col 4 = $ amt
                     - col 5 = transaction
						   - end loop
				       - navigate to next page
						      - Find href with class="ui-paginator-next"
                  - If it does NOT have class="ui-state-disabled" then click it
			      - end loop
				 
				    - Examples
               - Buy month pass: 3=issue a new card / ticket, 4=$128.00, 5=WCTA Full Fare Monthly Pass 2 Zones
               - use monthly pass: 3=Validation or deduction of SV amount, 4=$0.00, 5=Monthly Pass Full Zone 2
               - buy 10 trip ticket: 3=issue a new card / ticket, 4=$36.00, 5=WCTA 10 Trip Full 2 Zones
               - use 10 trip ticket: 3=Validation or deduction of SV amount, 4=$0.00, 5=10 Trip Full Zone 2
         - click back button (id backButton)
				 - parse data and build message for phone

	    - wait for "Manage cards" page
	       - readTransactionsForCardByName("Brian #2")
	 - logout()
	    -click logOut button (id sectionNavigation:nav_logout)

	 - send message to phone


*/	
	_driver
	  .then(() => login())
		.then(() => welcomePage())
		.then(() => manageCardsPage())
		.then(message => sendBusPassBalancesToBrian(message))
		.then(() => logout())
		.then(() => quit());
return;


function getFormattedRunDate() {
  return utils.today.format("M/D");
}


function login() {
  logger.verbose("IN login");
	
  _driver.get(utils.configuration.buspass.url);
  _driver
	  .wait(until.elementLocated(by.id("LoginButton")), 10000)
    .then(
      () => {
        _driver.findElement(by.id("EMAIL")).sendKeys(utils.configuration.buspass.username);
        _driver.findElement(by.id("PASSWORD")).sendKeys(utils.configuration.buspass.password);
        _driver.findElement(by.id("LoginButton")).click();
      },
      err => logger.error('IN login - ERROR: %s', err)
		);
}


function welcomePage() {
  _driver
	  .wait(until.elementLocated(by.id("sectionNavigation:nav_listCards")), 10000)
    .then(
      () => {
        _driver.findElement(by.id("sectionNavigation:nav_listCards")).click();
      },
      err => logger.error('IN welcomePage - ERROR: %s', err)
		);
}


function manageCardsPage() {
	return new Promise((resolve, reject) => {
		var messageToPhone = format("bus_pass|{0}|{1}|", moment().format("YYYYMMDDHHmmss"), getFormattedRunDate());

		_driver
			.wait(until.elementLocated(by.id("cards")), 10000)
			.then(() => {
				return readTransactionsForCardByNumber(1); 
			})
			.then(cardData => {
				logger.verbose("MANAGE CARDS PAGE #1. msg=%s", cardData);
				messageToPhone += cardData;
				
				_driver
					.wait(until.elementLocated(by.id("cards")), 10000);
			})
			.then(() => {
				return readTransactionsForCardByNumber(2); 
			})
			.then(cardData => {
				messageToPhone += format("|{0}|", cardData);
				logger.verbose("MANAGE CARDS PAGE #2. cardData=%s, msgToPhone=%s", cardData, messageToPhone);
				
				resolve(messageToPhone);
			});
	});
}


function readTransactionsForCardByNumber(cardNumber) {
	/*
			- readTransactionsForCardByName(cardName) eg "Brian"
			   - search table rows for "Brian" (cards:0:cardAliasInput) and select radio button
         - Check radio button using   $x("//*[@id='cards_data']/tr[xxx]/td[1]/div/div[1]/input")[0].checked = true
   				 where xxx = 1 for 1st row (Brian #2 ...685), 2 for second row (Brian ...453)
         - Click "Balance/Transactions" button (id showCardTransactionsButton)
	       
				 - readCardBalances()
         - click back button (id backButton)
				 - parse data and build message for phone
  */
	return new Promise((resolve, reject) => {
		logger.verbose("IN readTransactionsForCardByNumber(%s)", cardNumber);
		
		var xpathCard = format("//*[@id='cards_data']/tr[{0}]/td[1]/div/div[2]/span", cardNumber);
		var events = [];
			
		_driver.findElement(by.xpath(xpathCard)).click();
		_driver
			.wait(until.elementLocated(by.id("showCardTransactionsButton")), 10000)
			.then(() => {
				logger.verbose("Found show transactions button");
				utils.sleep(500);
				_driver.findElement(by.id("showCardTransactionsButton")).click();
				
				return readCardBalances(events, 1);
			})
			.then(cardData => {
				logger.verbose("IN readTransactionsForCardByNumber(%s), cardData=%s", cardNumber, cardData);
				
				_driver.findElement(by.id("backButton")).click();
				
				resolve(cardData);
			});
	});
}


function readCardBalances(events, pageNumber) {
	/*
		 - readCardBalances()
				- wait for "Card Balance and Transaction History" page
					 - set list of transactions = []
					 - get total number of pages from "class=ui-paginator-current" (ie "(x of y)")
					 - for loop through all y pages "(x of y)"
					 - for each row in tbody //*[@id="dataTable_data"]
							- read a line and append to array
							- table row 
								 - col 1 = mm/dd/yyyy hh:mm AM/PM
								 - col 2 = bus id
								 - col 3 = action 
								 - col 4 = $ amt
								 - col 5 = transaction
					 - end loop
					 - navigate to next page
							- Find href with class="ui-paginator-next"
							- If it does NOT have class="ui-state-disabled" then click it
				- end loop
		 
				- Examples
					 - Buy month pass: 3=issue a new card / ticket, 4=$128.00, 5=WCTA Full Fare Monthly Pass 2 Zones
					 - use monthly pass: 3=Validation or deduction of SV amount, 4=$0.00, 5=Monthly Pass Full Zone 2
					 - buy 10 trip ticket: 3=issue a new card / ticket, 4=$36.00, 5=WCTA 10 Trip Full 2 Zones
					 - use 10 trip ticket: 3=Validation or deduction of SV amount, 4=$0.00, 5=10 Trip Full Zone 2
         - click back button (id backButton)
				 - parse data and build message for phone
				 
				 
				 
				 
		Web page data
		
		Monthly Pass
		   Buy - mm/dd/yy hh:MM AM/PM | xxxxx | issue a new card xxx        | $128.00 | xxx Monthly Pass xxx
			 Use - mm/dd/yy hh:MM AM/PM | xxxxx | Validation or deduction xxx | $0.00   | xxx Monthly Pass xxx
		10 trip
		   Buy - mm/dd/yy hh:MM AM/PM | xxxxx | issue a new card xxx        | $36.00  | xxx 10 Trip xxx
			 Use - mm/dd/yy hh:MM AM/PM | xxxxx | Validation or deduction xxx | $0.00   | xxx 10 Trip xxx
				 
	*/
	return new Promise((resolve, reject) => {
		logger.verbose("IN readCardBalances for page %s", pageNumber);
		
		var xpathPaginator = format("//*[text()[contains(.,'({0} of ')]]", pageNumber);
    var xpathDesiredTransactions = "//tr[contains(@class, 'ui-widget-content') and not (contains(@class, 'canceledTransaction'))]";
		var xpathNextPageButton = "//a[contains(@class, 'ui-paginator-next') and not (contains(@class, 'ui-state-disabled'))]";
		
		_driver
			.wait(until.elementLocated(by.xpath(xpathPaginator)), 10000)
			.then(() => {
				return _driver.findElement(by.className("ui-paginator-current"));
			})
			.then(currentPaginator => {
				return currentPaginator.getText();
			})
			.then(pageXofY => {
				logger.verbose("  %s", pageXofY);
				
				// Need to not include canceled/invalid/failed transactions, which have the CSS class canceledTransaction
				return _driver.findElements(by.xpath(xpathDesiredTransactions));
			})
			.then(rows => {
				rows.map(row => row.getText().then(rowText => parseRow(rowText, events)));
				return _driver.findElement(by.xpath(xpathNextPageButton));
			})
			.then(
				nextPaginator => {
					nextPaginator.click();
					_driver.then(() => resolve(readCardBalances(events, pageNumber+1)));
				},
				err => {
					resolve(calculatePhoneMessage(events));
			});
	});	
}


function parseRow(rowText, events) {
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
	
	if (eventInfo.action != null && eventInfo.passType != null) {
    logger.verbose("    %s %s pass @ %s", eventInfo.action[0].toUpperCase() + eventInfo.action.substring(1), eventInfo.passType, eventInfo.dateTime.format("MM/DD/YYYY hh:mm A"));
		events.push(eventInfo);
  } else {
    logger.verbose("    >>> No useful event: %s", rowText);
	}
}


function calculatePhoneMessage(events) {
	// ASSUMES array is sorted with most recent records FIRST
	var cardData = "";
	
	var latestPurchaseIndex = events.findIndex(e => e.action === "purchased");
	var latestPurchase = events[latestPurchaseIndex];
	
	// Remove all items in array after the latest purchase, leaving only 
	// elements that happened after the purchase.
	events.splice(latestPurchaseIndex, events.length-latestPurchaseIndex-1);

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
			var tripsUsed = events.filter(e => e.action === "used" && e.passType === "10 trip").length;
			var tripsRemaining = 10 - tripsUsed;
			
			cardData = tripsRemaining + " left";
		  break;
	}

	logger.verbose("CALC CARD DATA- %s", cardData);
	return cardData;
}


function sendBusPassBalancesToBrian(message) {
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
	  .wait(until.elementLocated(by.id("sectionNavigation:nav_logout")), 10000)
    .then(
      () => {
        _driver.findElement(by.id("sectionNavigation:nav_logout")).click();
      },
      err => logger.error('IN logout - ERROR: %s', err));
}


function quit() {
  logger.verbose("  IN quit");

  _driver
	  _driver.wait(until.elementLocated(by.id("LoginButton")), 10000)
    .then(
      () => {
        _driver.quit();
      },
      err => logger.error('IN quit - ERROR: %s', err));
}