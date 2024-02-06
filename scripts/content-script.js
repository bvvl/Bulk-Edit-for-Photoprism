const pause = async (msec) => new Promise((resolve) => setTimeout(resolve, msec));
const aLittleWhile = 20; // msec


chrome.runtime.onMessage.addListener(
	function(message, sender, sendResponse) {
		processMessage(message).then((response) => {  // return response from processed message
			sendResponse(response);
		});
		return true;
	}
);

async function processMessage(message) {
	try {
		switch (message.purpose) {
			case "items-count":
				const element = document.querySelector("#t-clipboard > button .count-clipboard");
				return element ? itemsCount = parseInt(element.textContent) : 0;
			case "gather-data":
				return gatherData();
			case "commit-changes":
				return await commitDataChanges(message.param);
			default:
				console.log('Programming error => processMessage in content-script.js unkown message', message.purpose, '\n', new Error().stack);
		}
	}
	catch (error) {
		console.log("Programming error => ", error.toString(), new Error().stack);
	}
}

///////////// following functions rely on Photoprism html layout /////////////////////////////////////////////

function isInEditMode() {  // check if row with photo edit details/labels/people selector is visible
	const selectContainer = document.querySelector("#app div.v-tabs__container");
	return selectContainer ? !(selectContainer.offsetWidth <= 0 && selectContainer.offsetHeight <= 0) : false;
}

function getCloseButton() { // from photo edit details/labels/people page
	return document.querySelector("#app nav.v-toolbar button.action-close");
}

function getNextButton() { // from photo edit details/labels/people page
	return document.querySelector('#app nav.v-toolbar button.action-next');
}

function getApplyButton() { // from photo edit details page
	return document.querySelector('#app button.action-apply');
}

function getActionsMenuButton() { // from page with item(s) selected - round button with count at bottom right
	return document.querySelector("#t-clipboard > button.action-menu");
}

function getEditButton() { // Edit button in actions menu after count button pressed
	return document.querySelector("#t-clipboard button.action-edit");
}

function getDetailsButton() { // from photo edit details/labels/people page
	return document.querySelector("#tab-details > a.v-tabs__item");
}

function getLabelsButton() { // from photo edit details/labels/people page
	return document.querySelector("#tab-labels > a.v-tabs__item");
}

/**
* @return {[string]}
*/
function getKeywords() { // on photo edit DETAILS page
	return document.querySelector("#app div.p-tab-photo-details div.input-keywords textarea").value.split(/,\s*/);
}

/**
* @return {[string]}
*/
function getSubject() { // on photo edit DETAILS page
	const subject = document.querySelector("#app div.p-tab-photo-details div.input-subject textarea").value;
	return subject == '' ? [] : [subject];
}

/**
* @return {[string]}
*/
function getArtist() { // on photo edit DETAILS page
	const artist = document.querySelector("#app div.p-tab-photo-details div.input-artist input").value;
	return artist == '' ? [] : [artist];
}

/**
* @return {[string]}
*/
function getLabels() { // on photo edit LABELS page
	const labelRows = document.querySelectorAll('#app table.v-datatable tbody tr')
	let labels = [];
	for (const labelRow of labelRows) {
		const labelTextElement = labelRow.querySelector("a");
		if (labelTextElement) {
			const labelConfidence = labelRow.querySelectorAll("td").item(2).textContent;
			if (labelTextElement && labelConfidence != '0%') {
				labels.push(labelTextElement.textContent.replace(/\s|\\n?/g, ''));
			}
		}
	}
	return labels;
}

function isPhotoprismStillUpdating() {
	return document.querySelector("#photoprism > div.v-snack") != null;
}

////////////////// put routines /////////////////////////////////////////////////////////////////////////
//	Photoprism data model inputs can only be updated from a script running in the MAIN world.
//	Could only accomplish this by injecting a script in from the extension context via 
//	chrome.scripting.executeScript(). A request is sent from this content-script to the extension script
//	which in turn injects the data model update back into the content space.

/**
* @param userInputData {{"Common": [],
*					    "Uncommon": []}}
* @param currentValues {[string]}
* @return {[string]}
*/
function updateValues(userInputData, currentValues) {
	let values = JSON.parse(JSON.stringify(currentValues));
	for (const userInputValue of userInputData.Common.concat(userInputData.Uncommon)) {
		if (userInputValue.status == 'delete') {
			if (values.includes(userInputValue.content)) {
				values.splice(values.indexOf(userInputValue.content), 1);
			}
		}
	}
	for (const userInputValue of userInputData.Common.concat(userInputData.Uncommon)) {
		if (userInputValue.status == 'add') {
			values.push(userInputValue.content);
		}
	}
	return values;
}

async function putDetails(inputType, userInputData, oldValues) { // on photo edit DETAILS page
	const values = updateValues(userInputData, oldValues);
	if (oldValues.length != values.length || !oldValues.every((value, index) => value == values[index])) {
		try {
			await executeInExtension({
				purpose: "put-data-model-value",
				param: {
					inputType: inputType,
					value: values.toString().replace(/(.),(.)/g, '$1, $2'),
				}
			});
		} catch (error) {
			console.log("*** put() for " + inputType + " failed => ", error);
			return false;
		}
		return true;
	} else {
		return false;
	}
}



/**
* @param labels {[string]}
* @return dirty
*/
async function putLabels(userInputData) { // on photo edit DETAILS page
	let oldLabels = getLabels();
	const newLabels = updateValues(userInputData, oldLabels);
	if (oldLabels.length != newLabels.length || !oldLabels.every((value, index) => value == newLabels[index])) {
		let labelsToBeDeleted = [];
		let labelsToBeAdded = [];
		for (const label of newLabels) {
			if (!oldLabels.includes(label)) {
				labelsToBeAdded.push(label);
			}
		}
		for (const label of oldLabels) {
			if (!newLabels.includes(label)) {
				labelsToBeDeleted.push(label);
			}
		}
		try {
			for (const label of labelsToBeDeleted) {
				const labelRow = findLabelRow(label);
				const removeButton = labelRow.querySelector("button.action-remove");
				if (removeButton) { // use of remove or delete depends on how label was created in first place
					removeButton.click();
				} else {
					labelRow.querySelector("button.action-delete").click();
				}
			}
			for (const label of labelsToBeAdded) {
				await executeInExtension({
					purpose: "put-data-model-value",
					param: {
						inputType: `input-label`,
						value: label,
					}
				});
				document.querySelector('#app div.p-tab-photo-labels table.v-datatable tfoot tr button.p-photo-label-add').click();
			}
		} catch (error) {
			console.log("*** putLabels() failed => ", error);
			return false;
		}
		return true;
	} else {
		return false;
	}

	function findLabelRow(label) {
		const labelRows = document.querySelectorAll('#app div.p-tab-photo-labels table.v-datatable tbody tr')
		for (const labelRow of labelRows) {
			const labelTextElement = labelRow.querySelector("a");
			if (labelTextElement.textContent.replace(/\s|\\n?/g, '') == label) {
				return labelRow;
			}
		}
		return null;
	}
}


///////////////////////// main functions ///////////////////////////////////////////////////////////////////

/**
* @return boolean
*/
async function putInEditMode() {
	if (isInEditMode()) { // exit edit mode - will get restarted when processing first item
		getCloseButton().click();
		await pause(aLittleWhile);  // wait a little while after clicking detailsButton
	}
	const actionsMenuButton = getActionsMenuButton();
	let editButton = getEditButton();
	if ((!editButton && actionsMenuButton) || editButton && editButton.getAttribute("class").includes("hidden-shared-only")) {
		actionsMenuButton.click();
		await pause(aLittleWhile);  // wait a little while after clicking actionsButton
		editButton = getEditButton();
	}
	if (editButton) {
		editButton.click();
		await pause(500);  // wait a little while after clicking editButton
		return true;
	} else {
		return false;
	}
}


/**
* @return data 
*/
async function gatherData() {
	let numItemsProcessed = 0;
	let data = {
		"Keywords": {
			"Common": [],
			"Uncommon": [],
		},
		"Subject": {
			"Common": [],
			"Uncommon": [],
		},
		"Labels": {
			"Common": [],
			"Uncommon": [],
		},
		"Artist": {
			"Common": [],
			"Uncommon": [],
		}
	};

	await putInEditMode();

	do {  // loop through all selected items
		numItemsProcessed++;

		// get Keywords from DETAILS page
		getDetailsButton().click();
		await pause(aLittleWhile);  // wait a little while after clicking detailsButton
		mergeValuesInto("Keywords", getKeywords());

		// get Subject from DETAILS page
		mergeValuesInto("Subject", getSubject());

		// get Artist from DETAILS page
		mergeValuesInto("Artist", getArtist());

		// get Labels from LABELS page
		getLabelsButton().click();
		await pause(aLittleWhile);  // wait a little while after clicking detailsButton
		mergeValuesInto("Labels", getLabels());

		const nextButton = getNextButton();
		if (nextButton && !nextButton.disabled) {
			nextButton.click();         // go back to top of do loop and process next photo
			await pause(aLittleWhile);  // wait a little while after clicking nextButton
		} else {
			break;                      // finished last selected item
		}
	} while (true);  // end of do loop

	// quit edit mode after all selected photos processed
	getCloseButton().click();
	await pause(aLittleWhile);
	return data;


	/**
	* @param {string} field Keywords, Subject or Labels
	* @param {[]} newValues
	*/
	function mergeValuesInto(field, newValues) {
		if (numItemsProcessed == 1) { // first item so all values are common
			for (const newValue of newValues) {
				data[field].Common.push({ "content": newValue, "status": "no-change" });
			}
		} else {
			for (const newValue of newValues) {
				if (!isIncluded(newValue, data[field].Common)) { // newValue not in Common so add to Uncommon
					if (!isIncluded(newValue, data[field].Uncommon)) { // only once
						data[field].Uncommon.push({ "content": newValue, "status": "no-change" });
					}
				}
			}
			for (const value of data[field].Common) {
				if (!newValues.includes(value.content)) { // a value in newValues isn't in Common so remove it from Common and add to Uncommon
					const [removedValue] = data[field].Common.splice(data[field].Common.indexOf(value), 1);
					data[field].Uncommon.push(removedValue);
				}
			}
		}

		/** @param {string} value
		*	@param {[{content: string, status: string}]} inDataArray
		*/
		function isIncluded(value, inDataArray) {
			for (const data of inDataArray) {
				if (data.content == value) {
					return true;
				}
			}
			return false;
		}
	}
}

/**
* @param userInputData {{"Keywords": {"Common": [],
*									"Uncommon": []},
*						"Subject": {"Common": [],
*									"Uncommon": []},
*						"Labels": {"Common": [],
*						  			"Uncommon": []}
*						"Artist": {"Common": [],
*									"Uncommon": []}}
*/
async function commitDataChanges(userInputData) {
	let numItemsProcessed = 0;
	await putInEditMode();
	await pause(aLittleWhile);

	do {  // loop through all selected items
		numItemsProcessed++;
		try {
			let detailsPageIsDirty = false;

			getDetailsButton().click();
			await pause(aLittleWhile);  // wait a little while after clicking detailsButton

			// keywords in DETAILS page
			detailsPageIsDirty |= await putDetails('input-keywords', userInputData.Keywords, getKeywords());

			// subject in DETAILS page
			detailsPageIsDirty |= await putDetails('input-subject', userInputData.Subject, getSubject());

			// artist in DETAILS page
			detailsPageIsDirty |= await putDetails('input-artist', userInputData.Artist, getArtist());

			if (detailsPageIsDirty) {
				getApplyButton().click();
				await pause(aLittleWhile);  // wait a little while after clicking applyButton
			}

			getLabelsButton().click();
			await pause(aLittleWhile);  // wait a little while after clicking detailsButton

			// labels in LABELS page
			await putLabels(userInputData.Labels);

			const nextButton = getNextButton();
			if (nextButton && !nextButton.disabled) {
				nextButton.click();         // go back to top of do loop and process next photo
				await pause(aLittleWhile);  // wait a little while after clicking nextButton
			} else {
				break;                      // finished last selected item
			}
		} catch (error) {
			console.log("Programming error => ", error.toString(), new Error().stack);
			break;
		}
	} while (true);  // end of do loop

	// quit edit mode after all selected photos processed
	getCloseButton().click();
	await waitForPhotoprismUpdateToFinish();
	return numItemsProcessed;

}

const waitForPhotoprismUpdateToFinish = async () => await new Promise((resolve, reject) => {
	const loop = () => isPhotoprismStillUpdating() ? setTimeout(loop, 1000) : resolve();
	loop();
})


async function executeInExtension(message) {  // pass message to content-script.js
	return await new Promise(async (resolve, reject) => {
		await chrome.runtime.sendMessage(message, (messageResponse) => {
			resolve(messageResponse);
			return messageResponse;
		})
	})
}



