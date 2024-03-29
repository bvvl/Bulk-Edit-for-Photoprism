
const angularModule = angular.module('batchEditorApp', []);

angularModule.controller('batchEditorController', ['$scope', function ($scope) {

	let currentTab;  // will be set in gatherData()
	
	$scope.gatherData = async function () {
		try {
			$scope.htmlPhase = 0;
			$scope.dirtyCount = 0;
			if (!currentTab) {
				[currentTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
			}
			const isEditable = currentTab.title.includes('PhotoPrism') &&
				!/(\/folders|\/labels|\/moments|\/people|\/albums|\/calendar)$/.test(currentTab.url);
			$scope.selectedItemsCount = isEditable ? await executeInContentScript(currentTab, { purpose: "items-count" }) : 0;
			$scope.$apply();
			if ($scope.selectedItemsCount > 0) {
				$scope.dirtyCount = 0;
				$scope.disableInput = { "Subject": false, "Artist": false, "Copyright": false, "Date": false};  // used to disable inputs for single value fields
				$scope.selectedItemsData = await executeInContentScript(currentTab, { purpose: "gather-data" });
				$scope.htmlPhase = 1;
				$scope.$apply();
			}
		} catch (error) {
			$scope.htmlPhase = 'error';
			console.log("Programming error in gatherData => ", error.toString(), new Error().stack);
			$scope.error = "Programming error in onCommit => " + error
			$scope.errorStack = new Error().stack;
			$scope.$apply();
		}
	};
	$scope.gatherData();


	//////// onClick handlers ///////////////////////////////////////////////////////////////

	$scope.onCommit = async function() {  // send request off to the content-script
		try {
			if (isValidDate()) {
				$scope.htmlPhase = 2;
				$scope.numberOfItemsUpdated = await executeInContentScript(currentTab, {
					purpose: "commit-changes",
					param: $scope.selectedItemsData
				});
				$scope.htmlPhase = 3;
				$scope.$apply();
			} else {
				alert ('Invalid date')
			}
		} catch (error) {
			$scope.htmlPhase = 'error';
			console.log("Programming error in onCommit => ", error.toString(), new Error().stack);
			$scope.error = "Programming error in onCommit => " + error
			$scope.errorStack = new Error().stack;
			$scope.$apply();
		}
	}
	
	function isValidDate() {
		for (date of $scope.selectedItemsData.Date.Common) {
			if (date.status == "add") {
				if (date.content.trim().match(/^\d{1,2} *[a-zA-Z]{3} *\d{4}$/)) {
					const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
					const [, day, month, year] = date.content.match(/(\d{1,2}) *([a-zA-Z]{3}) *(\d{4})/);
					const indexOf = (arr, q) => arr.findIndex(item => q.toLowerCase() === item.toLowerCase());
					dateObject = new Date(year.toString() + '/' + (indexOf(months, month) + 1).toString() + '/' + day.toString());
					return dateObject == "Invalid Date" ? false : true;
				} else {
					return false;
				}
			}
		}
		return true;
	}

	$scope.onReload = function() {
		$scope.gatherData();
	}

	$scope.onClose = function() {
		window.close();
	}

	$scope.onAddNewCommonValue = function(field) {
		if (Object.keys($scope.disableInput).some(key => key === field)) {  // if so, mark all common and uncommon for delete
			const deleteSwitches = document.querySelectorAll('label.' + field + '-delete');
			for (const deleteSwitch of deleteSwitches) {
				if (deleteSwitch.querySelector('span.tooltiptext').innerHTML != 'will be deleted') { // 'mark for delete' is not clicked
					deleteSwitch.querySelector('input').click();
				}
			}
			$scope.disableInput[field] = true;
		}
		$scope.selectedItemsData[field].Common.push({ "content": "", "status": "add" });
		$scope.dirtyCount ++;
	}

	$scope.onRemoveNewValue = function(value, category, field) {
		if (Object.keys($scope.disableInput).some(key => key === field)) {
			$scope.disableInput[field] = false;
			const deleteSwitches = document.querySelectorAll('label.' + field + '-delete');
			for (const deleteSwitch of deleteSwitches) {
				const input = deleteSwitch.querySelector('input');
				if (input.disabled) {
					input.removeAttribute('disabled')
				}
				deleteSwitch.querySelector('input').click();
			}
		}
		$scope.selectedItemsData[field][category].splice($scope.selectedItemsData[field][category].indexOf(value), 1);
		$scope.dirtyCount --;
	}

	$scope.onToggleDeleteStatus = function(value, category, field) {
		const valueIndex = $scope.selectedItemsData[field][category].indexOf(value);
		if ($scope.selectedItemsData[field][category][valueIndex].status != "delete") {
			$scope.selectedItemsData[field][category][valueIndex].status = "delete";
			$scope.dirtyCount ++;
		} else {
			$scope.selectedItemsData[field][category][valueIndex].status = "no-change";
			$scope.dirtyCount --;
		}
	}

	////////////////////  Photoprism data model put routines ////////////////////////////////////////////

	chrome.runtime.onMessage.addListener(
		function(message, sender, sendResponse) {
			processContentMessage(message).then((response) => {  // return response from processed message
				sendResponse(response);
			});
			return true;
		}
	);

	async function processContentMessage(message) {
		try {
			switch (message.purpose) {
				case "put-data-model-value":
					return await executeContentScript(message.param.inputType, message.param.value);
				default:
					console.log('Programming error => processMessage in content-script.js unkown message', message.purpose, '\n', new Error().stack);
					return false;
			}
		}
		catch (error) {
			console.log("Programming error => ", error.toString(), new Error().stack);
			return false;
		}
	}

	async function executeContentScript(...args) {
		const [{ result }] = await chrome.scripting.executeScript({
			args,
			func: (inputType, value) => {
				try {
					const form = inputType == 'input-label' ?
						document.querySelector('#app div.p-tab-photo-labels form') :
						document.querySelector('#app form.p-form-photo-details-meta');
					const element = form.__vue__._data.inputs.find((element) =>
						element.$el.className.includes(inputType),
					);
					element.internalValue = value;
				} catch (error) {
					console.log("*** put for " + inputType + " failed => ", error);
					return false;
				}
				return true;
			},
			target: {
				tabId: currentTab.id,
			},
			world: "MAIN",
		});
		return result;
	}
	
	//////// utility stuff ////////////////////////////////////////////////////

	async function executeInContentScript(tab, message) {  // pass message to content-script.js
		return await new Promise(async (resolve, reject) => {
			await chrome.tabs.sendMessage(tab.id, message, (messageResponse) => {
				resolve(messageResponse);
				return messageResponse;
			});
		});
	}

	$scope.onTextInputMouseover = function(event) {
		const textContent = event.target.value.trim()
		if (textContent && event.target.scrollWidth > event.target.clientWidth) {
			if (event.type === 'mouseover') {
				const inputTop = event.target.getBoundingClientRect().top
				const inputLeft = event.target.getBoundingClientRect().left
				const inputHeight = event.target.getBoundingClientRect().height
				document.documentElement.style.setProperty('--e-target-top', `${inputTop - inputHeight}px`)
				document.documentElement.style.setProperty('--e-target-left', `${inputLeft}px`)
				const span = `<span class="overflow-content">${textContent}</span>`
				event.target.insertAdjacentHTML('afterend', span)
			}
			if (event.type === 'mouseout' && document.querySelector('.overflow-content')) {
				document.querySelector('.overflow-content').remove()
			}
		}
	}
 
	console.log = (async (...message) => {  // send to background-script to log in extension's console
		await chrome.runtime.sendMessage({ purpose: "log", message: message });
	});

	console.error = (async (...message) => {  // send to background-script to log in extension's console
		await chrome.runtime.sendMessage({ purpose: "log", message: message });
	});
	
}]);

angularModule.directive('autofocus', ['$timeout', function($timeout) {
	return {
		restrict: 'A',
		link: function($scope, $element) {
			$timeout(function() {
				$element[0].focus();
			});
		}
	}
}]);
