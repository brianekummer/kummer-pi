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


// ****** TO DO ********
//  1. Backup changes to kummer-pi.env, since I added credentials for buss pass

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
		.then((message) => sendBusPassBalancesToBrian(message))
		.then(() => logout());
return;


function getFormattedRunDate() {
  return utils.today.format("M/D");
}


function login() {
  logger.verbose("IN login");
	
  _driver.get(utils.configuration.buspass.url);
  _driver.wait(until.elementLocated(by.id("LoginButton")), 10000)
    .then(
      () => {
        //utils.sleep(500);
        _driver.findElement(by.id("EMAIL")).sendKeys(utils.configuration.buspass.username);
        _driver.findElement(by.id("PASSWORD")).sendKeys(utils.configuration.buspass.password);
        _driver.findElement(by.id("LoginButton")).click();
      },
      (err) => logger.error('IN login - ERROR: %s', err)
		);
}


function welcomePage() {
  _driver.wait(until.elementLocated(by.id("sectionNavigation:nav_listCards")), 10000)
    .then(
      () => {
        //utils.sleep(500);
        _driver.findElement(by.id("sectionNavigation:nav_listCards")).click();
      },
      (err) => logger.error('IN welcomePage - ERROR: %s', err));
}


function manageCardsPage() {
	/*
   - manageCardsPage()
		  - wait for "Manage cards" page
			- readTransactionsForCardByNumber(1)
	    - wait for "Manage cards" page
      - readTransactionsForCardByNumber(2)
  */
	var messageToPhone = format("bus_pass|{0}|{1}|", moment().format("YYYYMMDDHHmmss"), getFormattedRunDate());

  _driver
	  .wait(until.elementLocated(by.id("cards")), 10000)
    .then(() => {
			messageToPhone += readTransactionsForCardByNumber(1);
			
      _driver
			  .wait(until.elementLocated(by.id("cards")), 10000)
        .then(() => {
			    messageToPhone += readTransactionsForCardByNumber(2);

        	return messageToPhone;
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
	logger.verbose("IN readTransactionsForCardByNumber(%s)", cardNumber);
	
	var xpathQuery = format("//*[@id='cards_data']/tr[{0}]/td[1]/div/div[2]/span", cardNumber);
		
  _driver.findElement(by.xpath(xpathQuery)).click();
  _driver
	  .wait(until.elementLocated(by.id("showCardTransactionsButton")), 10000)
    .then(() => {
      utils.sleep(500);
    	_driver.findElement(by.id("showCardTransactionsButton")).click();
			
			readCardBalances();
		
		  _driver.findElement(by.id("backButton")).click();
	  });
}


function readCardBalances() {
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
	*/
	logger.verbose("IN readCardBalances");
	
	var cardData = "";
	var transactions = [];
	var pageInfo = "";
	
	_driver
	  .wait(until.elementLocated(by.id("dataTable_data")), 10000)
    .then(() => {
		  _driver
		    .findElement(by.className("ui-paginator-current"))
		    .then((currentPaginator) => {
				  currentPaginator
  				  .getText()
					  .then(pageInfo => {
			        logger.verbose("page info is %s", pageInfo);
						
						  // This might be useful
						  // https://stackoverflow.com/questions/35098156/get-an-array-of-elements-from-findelementby-classname
						  _driver
							  // Need to not include canceled transactions, which have the CSS class canceledTransaction
						    .findElements(by.xpath("//tr[contains(@class, 'ui-widget-content') and not(contains(@class, 'canceledTransaction'))]"))
							  .then(rows => {
  								logger.verbose("IN readCardBalances. rows.length is %d", rows.length);
									var rowNum = 0;
								  rows.forEach(row => {
         						// element is tbody tag full of rows
								    logger.verbose("row #%s: ", rowNum);
										getCardTransaction(rowNum, row);
								    rowNum ++;
									});
									
									
									_driver
									  .findElement(by.className("ui-paginator-next"))
										.then((nextPaginator) => {
											logger.verbose("next is %s", nextPaginator);

											
											//	return cardData;
										});
								});
							});
				});
		});
}


function getCardTransaction(rowNum, row) {
  logger.verbose("    IN getCardTransaction(row=%s)", row);

  row
    .getText()
    .then(rowText => {
      logger.verbose("    Row Text=%s", rowText);
    });
}


function sendBusPassBalancesToBrian(message) {
  _driver
    .then(() => {
      utils.sendMessageToPhone(utils.configuration.family["brian"], message);
      logger.info("SENT bus pass balances to %s: %s", "Brian", message);
    });
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