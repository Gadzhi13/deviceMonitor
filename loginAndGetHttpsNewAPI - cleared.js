var https = require('https');
var fs = require('fs');

//variables used in script, do not change
var endRes = "";
var connected = 0;
var totalDevOnConnector = 0;
var disconnectedDevices = "";
var prefix = "MCDeviceID__";
var pathToLocal = "C:\\check_mk\\local\\";
var pathToScript = "";

//varaibles for user/connector/host/port data, subejct to change
var credentials = '{"name" : "check_mk@postuser.com","password": ""}';
var host = "localhost";
var port = 8080;
var connectorName = "MC_Connector_test"; //change this variable acordingly


var postOptions = {
	host: host,
	port: port,
	path: '/rest/client/login',
	//the next tag is only used because our certificate was self-signed, having a CA certificate should solve the problem
	"rejectUnauthorized": false,
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
		'Accept': 'application/json',
		'Content-Length': Buffer.byteLength(credentials)
	}
};

var getOptions = {
	hotsname: host,
	port: port,
	path: "/rest/deviceContent",
	//the next tag is only used because our certificate was self-signed, having a CA certificate should solve the problem
	"rejectUnauthorized": false,
	headers: {
		"Cookie": ""
	}
};

//main function used to send a POST to MC login API
function login(data) {
	var post_req = https.request(postOptions, res => {
		res.setEncoding('utf8');
		res.on('data', function (chunk) {});
		res.on('end', () => {
			getDevices(res.headers["set-cookie"]);
		});
	}).on('error', (e) => {
		console.error(e.message);
	});

	//calling write sends the data to https module and then to MC
	post_req.write(data);
	post_req.end();
}

//next main function after login, gets the login token in cookies from login function
function getDevices(cookies) {
	getOptions.headers["Cookie"] = cookies;
	var getCall = https.get(getOptions, (res)=> {
			res.on('data', chunk => {
				try {
					endRes = endRes.concat(chunk);
				} catch (err) {
					console.log("error from getDevices: " + err);
				}
			});
			res.on('end', () => {
				if (res.statusCode == 401) {
					console.log("2 ConnectorDevices - The Authentication is not going through. Please check the POST methods on MC Server and the access of check_mk@postuser.com user.");
					process.exit(1);
				};
				handleJson(endRes);
			});
	}).on('error', (e)=> {
		console.log('error from https.get: ' + e);
	});
}

//next main function that handles the received JSON data, loops through every device in the json data
//checks if it uses the needed conenctor, checks if the device is registered(connected) and sends the data to the createScript functions
//after creating device specific scripts - calls the consoleLog function to output the general status
//also start the handleFiles function at the end to sort out unused scripts
function handleJson(rawData) {
	var listTotalOnConnector = [];
	var listConnectedOnConnector = [];
	var listDisconnectedOnConnector = [];
	var parsed = sortWithFrequency(JSON.parse(rawData));
	for (i = 0; i < parsed.length; i++) {
		if (parsed[i].connectorName == connectorName ) { 						//connector check
			listTotalOnConnector.push(parsed[i]);
			var name = parsed[i].deviceName.split(" ").join("_");
			totalDevOnConnector++;
			pathToScript = pathToLocal + prefix + parsed[i].udid + ".bat";
			if (parsed[i].connected) { 											//connected status check
				connected++;
				listConnectedOnConnector.push(parsed[i].udid);
				createScriptConnected(pathToScript, name, parsed[i].connectorName);
			} else {
				disconnectedDevices = disconnectedDevices + " / " + parsed[i].deviceName;
				listDisconnectedOnConnector.push(parsed[i].udid);
				createScriptDisconnected(pathToScript, name, parsed[i].connectorName);
			};
		};
	};
	handleFiles(listConnectedOnConnector, listDisconnectedOnConnector);
	consoleLog();
}

function comparer(a, b) {
	return a.deviceName.toLowerCase().localeCompare(b.deviceName.toLowerCase());
}

function sortWithFrequency(arr) {
	var arr2 = [];
  var arr2DeviceNames = [];
	var arr2Freq = [];
  var currentFreq = [];

	arr.sort(comparer);

	arr.forEach(el => {
		if (!arr2DeviceNames.includes(el.deviceName)) {
      arr2DeviceNames.push(el.deviceName);
      currentFreq.push(1);
			arr2.push(el);
		};
	});

	arr2.forEach(el => {
		var freq = 0;
		arr.forEach(el2 => {
			if (el2.deviceName == el.deviceName) {
				freq++;
			};
		});
		arr2Freq.push(freq);
	});

	arr.forEach(el => {
		var index = arr2DeviceNames.indexOf(el.deviceName);
		if (arr2Freq[index] > currentFreq[index]) {
			el.deviceName = el.deviceName + "_" + currentFreq[index];
			currentFreq[index]++;
		};
	});

  return arr;
}

//simply opens a writeFile stream to create and !overwrite! the text - in this case for disconnected devices
//it creates a bat file with the batch script in it
//the script itself is in the fullText var of the function
//I opted out of checking of the file existsor not as the text will be overwritten anyways
function createScriptDisconnected(path, text, connector) {
	var fullText = `
	@echo off\r\n
	echo 1 ${connector}-${text} - Device ${text} is disconnected!
	`;
	fs.writeFile(path, fullText, (err) => {
		if (err) throw err;
	});
}

//the same but for connected devices
function createScriptConnected(path, text, connector) {
	var fullText = `
	@echo off\r\n
	echo 0 ${connector}-${text} - Device ${text} is connected!
	`;
	fs.writeFile(path, fullText, (err) => {
		if (err) throw err;
	});
}

function createScriptDeviceDeleted(path, textDevice, textService) {
	var fullText = `
	@echo off\r\n
	echo 0 ${textService} - This device was deleted from MC! Device: ${textDevice} If you will be connecting this device again, do not delete the check.
	`;
	fs.writeFile(path, fullText, (err) => {
		if (err) throw err;
	});
}

//goes through each file in the folder and takes those with the needed prefix
//then checks if the filename (device id) is in the list of devices on this connector
//this part is still on hold, as of 2.7 they are completely deleting the objects and thus code needs revision
function handleFiles(listConnected, listDisconnected) {
	fs.readdir(pathToLocal,(err, files) => {
		if (err) throw err;
		for (var i = 0; i < files.length; i++) {
			var fileID = files[i].split(".")[0].split("__")[1];
			if (files[i] !== undefined) {
				if (files[i].split("__")[0] == "MCDeviceID") {
					if (!listConnected.includes(fileID) && !listDisconnected.includes(fileID)) {
						try {
							var deviceName = '';
							var currentIndex = i;
							var data = fs.readFileSync(pathToLocal + files[i], 'utf8');
							var serviceName = data.split(' ')[3];
							var serviceNameSplitted = serviceName.split('_');
							for (var i = 1; i < serviceNameSplitted.length; i++) {
								deviceName += serviceNameSplitted[i];
							};
							deviceName = deviceName.split('Connectortest-')[1];
							createScriptDeviceDeleted(pathToLocal + files[currentIndex], deviceName, serviceName);
						} catch (err) {
							throw err;
						};
					};
				};
			};
		};
	});
}

//deletes the files parsed to it / DEPRECATED
function deleteScript(path) {
	fs.unlink(path, (err) => {
		if (err) {
			return;
		};
	});
}

//outputs he general info about MC, ok if all connected, warning if some devices are disconnected, critical if all are out
function consoleLog() {
	if (connected == totalDevOnConnector) {
		console.log(`0 ${connectorName}-Devices - All good! All devices connected! Keep it up!`);
	} else if (connected == 0) {
		console.log(`2 ${connectorName}-Devices - All down! All Devices disconnected!`);
	} else {
		console.log(`1 ${connectorName}-Devices - Some devices lost connection: ` + disconnectedDevices);
	};
}

//start point of the whole script
login(credentials);