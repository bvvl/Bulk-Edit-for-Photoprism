
chrome.runtime.onMessage.addListener(  // listen for message from app.js
	function(request, sender, sendResponse) {  // output message in extension's console
		if (request.purpose && request.purpose == "log")
			console.log( ...request.message);
	}
);
