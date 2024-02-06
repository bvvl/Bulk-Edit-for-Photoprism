
const angularModule = angular.module('batchEditorApp', []);

angularModule.controller('batchEditorController', ['$scope', function ($scope) {

	let currentTab;  // will be set in gatherData()

	$scope.gatherData = async function () {
		try {
			$scope.htmlPhase = 0;
			if (!currentTab) {
				[currentTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
			}
			const isEditable = currentTab.title.includes('PhotoPrism') &&
				!/(\/folders|\/labels|\/moments|\/people|\/albums|\/calendar)$/.test(currentTab.url);
			$scope.selectedItemsCount = isEditable ? await executeInContentScript(currentTab, { purpose: "items-count" }) : 0;
			$scope.$apply();
			if ($scope.selectedItemsCount > 0) {
				$scope.disableInputs = { "Subject": false, "Artist": false };  // used to disable inputs for single value fields
				$scope.selectedItemsData = await executeInContentScript(currentTab, { purpose: "gather-data" });
				$scope.htmlPhase = 1;
				$scope.$apply();
			}
		} catch (error) {
			$scope.htmlPhase = 'error';
			console.log("Programming error => ", error.toString(), new Error().stack);
			$scope.error = error
			$scope.errorStack = new Error().stack;
			$scope.$apply();
		}
	};
	$scope.gatherData();


	//////// onClick handlers ///////////////////////////////////////////////////////////////

	$scope.onCommit = async function() {  // send request off to the content-script 
		$scope.htmlPhase = 2;
		$scope.numberOfItemsUpdated = await executeInContentScript(currentTab, {purpose: "commit-changes", 
																			    param: $scope.selectedItemsData});
		$scope.htmlPhase = 3;
		$scope.$apply();
	}

	$scope.onReload = function() {
		$scope.gatherData();
	}

	$scope.onClose = function() {
		window.close();
	}

	$scope.onAddNewCommonValue = function(field) {
		if (Object.keys($scope.disableInputs).some(key => key === field)) {  // if so, mark all common and uncommon for remove
			const deleteSwitches = document.querySelectorAll('label.' + field + '-delete');
			for (const deleteSwitch of deleteSwitches) {
				if (deleteSwitch.querySelector('span.tooltiptext')) { // 'mark for remove' is not clicked
					deleteSwitch.querySelector('input').click();
				}
			}
			$scope.disableInputs[field] = true;
		}
		$scope.selectedItemsData[field].Common.push({ "content": "", "status": "add" });
	}

	$scope.onRemoveNewValue = function(value, category, field) {
		if (Object.keys($scope.disableInputs).some(key => key === field)) {
			$scope.disableInputs[field] = false;
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
	}

	$scope.onToggleDeleteStatus = function(value, category, field) {
		const valueIndex = $scope.selectedItemsData[field][category].indexOf(value);
		if ($scope.selectedItemsData[field][category][valueIndex].status != "delete") {
			$scope.selectedItemsData[field][category][valueIndex].status = "delete";
		} else {
			$scope.selectedItemsData[field][category][valueIndex].status = "no-change";
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
