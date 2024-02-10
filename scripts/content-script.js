const pause = async (msec) => new Promise((resolve) => setTimeout(resolve, msec));
const aLittleWhile = 30; // msec


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

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
* @return {[string]}
*/
function getDetails(field) { // on photo edit DETAILS page
	const input = 'input-' + field.toLowerCase()
	let value = [];
	switch (field) {
		case "Keywords":
			return document.querySelector(`#app div.p-tab-photo-details div.${input} textarea`).value.split(/,\s*/);
		case "Date":
			const day = document.querySelector(`#app div.p-tab-photo-details div.input-day input`).value;
			const month = document.querySelector(`#app div.p-tab-photo-details div.input-month input`).value;
			const year = document.querySelector(`#app div.p-tab-photo-details div.input-year input`).value;
			value = `${day}` + `${months[parseInt(month) - 1]}${year}`
			break;
		case "Subject":
			value = document.querySelector(`#app div.p-tab-photo-details div.${input} textarea`).value;
			break;
		case "Artist":
		case "Copyright":
			value = document.querySelector(`#app div.p-tab-photo-details div.${input} input`).value;
			break;
		default:
			throw `*** getDetails error - unknow field "${field}"`;
	}
	return value == '' ? [] : [value];
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

async function putDetails(field, userInputData) { // on photo edit DETAILS page
	const oldValues = getDetails(field);
	const values = updateValues(userInputData[field], oldValues);
	if (oldValues.length != values.length || !oldValues.every((value, index) => value == values[index])) {
		return field == "Date" ?
			putDate(values.toString()) :
			put(field.toLowerCase(), values.toString().replace(/(.),(.)/g, '$1, $2'));
	} else {
		return false;
	}
	
	async function put(input, value) {
		try {
			await executeInExtension({
				purpose: "put-data-model-value",
				param: {
					inputType: `input-${input}`,
					value: value,
				}
			});
		} catch (error) {
			console.log(`*** put() for ${input} failed => `, error);
			return false;
		}
		return true;
	}

	async function putDate(date) {
		let success = false;
		if (date != "") { // Date value is empty but Phtoprism doesn't allow setting date to nothing'
			const [, day, month, year] = date.match(/(\d{1,2}) *([a-zA-Z]{3}) *(\d{4})/);
			success |= await put('day', day);
			const indexOf = (arr, q) => arr.findIndex(item => q.toLowerCase() === item.toLowerCase());
			success |= await put('month', indexOf(months, month) + 1);
			success |= await put('year', year);
		} else {
			success = true;
		}
		return success;
	}
}

/**
* @param labels {[string]}
* @return dirty
*/
async function putLabels(userInputData) { // on photo edit DETAILS page
	let oldLabels = getLabels();
	const newLabels = updateValues(userInputData.Labels, oldLabels);
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
		"Labels": {
			"Common": [],
			"Uncommon": [],
		},
		"Subject": {
			"Common": [],
			"Uncommon": [],
		},
		"Date": {
			"Common": [],
			"Uncommon": [],
		},
		"Artist": {
			"Common": [],
			"Uncommon": [],
		},
		"Copyright": {
			"Common": [],
			"Uncommon": [],
		},
	};

	await putInEditMode();

	do {  // loop through all selected items
		numItemsProcessed++;

		// get values from DETAILS page
		getDetailsButton().click();
		await pause(aLittleWhile);  // wait a little while after clicking detailsButton
		mergeValuesInto("Keywords");
		mergeValuesInto("Subject");
		mergeValuesInto("Artist");
		mergeValuesInto("Copyright");
		mergeValuesInto("Date");

		// get Labels from LABELS page
		getLabelsButton().click();
		await pause(aLittleWhile);  // wait a little while after clicking detailsButton
		mergeValuesInto("Labels");

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
	function mergeValuesInto(field) {
		newValues = field == 'Labels' ? getLabels(field) : getDetails(field);
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

async function commitDataChanges(userInputData) {
	let numItemsProcessed = 0;
	await putInEditMode();
	await pause(aLittleWhile);

	do {  // loop through all selected items
		numItemsProcessed++;
		try {
			let detailsPageIsDirty = false;
			
			// update changes to DETAILS page
			getDetailsButton().click();
			await pause(aLittleWhile);  // wait a little while after clicking detailsButton
			detailsPageIsDirty |= await putDetails('Keywords', userInputData);
			detailsPageIsDirty |= await putDetails('Subject', userInputData);
			detailsPageIsDirty |= await putDetails('Artist', userInputData);
			detailsPageIsDirty |= await putDetails('Copyright', userInputData);
			detailsPageIsDirty |= await putDetails('Date', userInputData);
			if (detailsPageIsDirty) {
				getApplyButton().click();
				await pause(aLittleWhile);  // wait a little while after clicking applyButton
			}

			// update changes to LABELS page
			getLabelsButton().click();
			await pause(aLittleWhile);  // wait a little while after clicking detailsButton
			await putLabels(userInputData);

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



