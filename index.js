var dgram = require("dgram");
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function (homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform("homebridge-mihome", "MiHome", MiHomePlatform, true);
}

function MiHomePlatform(log, config, api) {
  this.log = log;
  this.config = config || {"platform": "MiHome"};
  this.devices = this.config.devices || [];

  this.accessories = {};

  if (api) {
    this.api = api;
    this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
  }
}

// Method to restore accessories from cache
MiHomePlatform.prototype.configureAccessory = function (accessory) {
  this.setService(accessory);
  this.accessories[accessory.context.name] = accessory;
}

// Method to setup accesories from config.json
MiHomePlatform.prototype.didFinishLaunching = function () {
  // Add or update accessories defined in config.json
  for (var i in this.devices) this.addAccessory(this.devices[i]);

  // Remove extra accessories in cache
  for (var name in this.accessories) {
    var accessory = this.accessories[name];
    if (!accessory.reachable) this.removeAccessory(accessory);
  }
}

// Method to add and update HomeKit accessories
MiHomePlatform.prototype.addAccessory = function (data) {
  this.log("Initializing platform accessory '" + data.name + "'...");

  // Retrieve accessory from cache
  var accessory = this.accessories[data.name];

  if (!accessory) {
    // Setup accessory as SWITCH (8) category.
    var uuid = UUIDGen.generate(data.name);
    accessory = new Accessory(data.name, uuid, 8);

    // Setup HomeKit switch service
    accessory.addService(Service.Switch, data.name);

    // New accessory is always reachable
    accessory.reachable = true;

    // Setup listeners for different switch events
    this.setService(accessory);

    // Register new accessory in HomeKit
    this.api.registerPlatformAccessories("homebridge-mihome", "MiHome", [accessory]);

    // Store accessory in cache
    this.accessories[data.name] = accessory;
  }

  // Confirm variable type
  if (data.manufacturer) data.manufacturer = data.manufacturer.toString();
  if (data.model) data.model = data.model.toString();
  if (data.serial) data.serial = data.serial.toString();

  // Store and initialize variables into context
  var cache = accessory.context;
  cache.name = data.name;
  cache.ip = data.ip
  cache.start = data.start;
  cache.stop = data.stop;
  cache.charge = data.charge;
  cache.locate = data.locate;
  cache.manufacturer = data.manufacturer;
  cache.model = data.model;
  cache.serial = data.serial;
  if (cache.state === undefined) cache.state = false;

  // Retrieve initial state
  this.getInitState(accessory);
}

// Method to remove accessories from HomeKit
MiHomePlatform.prototype.removeAccessory = function (accessory) {
  if (accessory) {
    var name = accessory.context.name;
    this.log(name + " is removed from HomeBridge.");
    this.api.unregisterPlatformAccessories("homebridge-mihome", "MiHome", [accessory]);
    delete this.accessories[name];
  }
}

// Method to setup listeners for different events
MiHomePlatform.prototype.setService = function (accessory) {
  accessory.getService(Service.Switch)
    .getCharacteristic(Characteristic.On)
    .on('get', this.getPowerState.bind(this, accessory.context))
    .on('set', this.setPowerState.bind(this, accessory.context));

  accessory.on('identify', this.identify.bind(this, accessory.context));
}

// Method to retrieve initial state
MiHomePlatform.prototype.getInitState = function (accessory) {
  var manufacturer = accessory.context.manufacturer || "Default-Manufacturer";
  var model = accessory.context.model || "Default-Model";
  var serial = accessory.context.serial || "Default-SerialNumber";

  // Update HomeKit accessory information
  accessory.getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, manufacturer)
    .setCharacteristic(Characteristic.Model, model)
    .setCharacteristic(Characteristic.SerialNumber, serial);

  // Retrieve initial state
  accessory.getService(Service.Switch)
    .getCharacteristic(Characteristic.On)
    .getValue();

  // Configured accessory is reachable
  accessory.updateReachability(true);
}

// Method to determine current state
MiHomePlatform.prototype.getPowerState = function (thisDevice, callback) {
  callback(null, thisDevice.state);
}

// Method to set state
MiHomePlatform.prototype.setPowerState = function (thisDevice, state, callback) {
  var self = this;

  var cmd = state ? thisDevice.start : thisDevice.stop;
  var message = new Buffer(cmd, 'hex');
  var device = dgram.createSocket('udp4');

  device.send(message, 0, message.length, 54321, thisDevice.ip, function(err, bytes) {
    if (err) {
      self.log("Failed to turn " + (state ? "on " : "off ") + thisDevice.name);
      self.log(err);
    } else {
      self.log(thisDevice.name + " is turned " + (state ? "on." : "off."));
      thisDevice.state = state;
    }
    device.close();
    callback(err);
  });
}

// Method to handle identify request
MiHomePlatform.prototype.identify = function (thisDevice, paired, callback) {
  var self = this;

  var message = new Buffer(thisDevice.locate, 'hex');
  var device = dgram.createSocket('udp4');

  device.send(message, 0, message.length, 54321, thisDevice.ip, function(err, bytes) {
    if (err) {
      self.log("Failed to identify " + thisDevice.name);
      self.log(err);
    } else {
      self.log(thisDevice.name + " identify requested!");
    }
    device.close();
    callback(err);
  });
}

// Method to handle plugin configuration in HomeKit app
MiHomePlatform.prototype.configurationRequestHandler = function (context, request, callback) {
  if (request && request.type === "Terminate") {
    return;
  }

  // Instruction
  if (!context.step) {
    var instructionResp = {
      "type": "Interface",
      "interface": "instruction",
      "title": "Before You Start...",
      "detail": "Please make sure homebridge is running with elevated privileges.",
      "showNextButton": true
    }

    context.step = 1;
    callback(instructionResp);
  } else {
    switch (context.step) {
      case 1:
        // Operation choices
        var respDict = {
          "type": "Interface",
          "interface": "list",
          "title": "What do you want to do?",
          "items": [
            "Add New Device",
            "Modify Existing Device",
            "Remove Existing Device"
          ]
        }

        context.step = 2;
        callback(respDict);
        break;
      case 2:
        var selection = request.response.selections[0];
        if (selection === 0) {
          // Info for new accessory
          var respDict = {
            "type": "Interface",
            "interface": "input",
            "title": "New Device",
            "items": [{
              "id": "name",
              "title": "Name (Required)",
              "placeholder": "Mi Robot Vacuum"
            }]
          };

          context.operation = 0;
          context.step = 3;
          callback(respDict);
        } else {
          var names = Object.keys(this.accessories);

          if (names.length > 0) {
            // Select existing accessory for modification or removal
            if (selection === 1) {
              var title = "Witch Device do you want to modify?";
              context.operation = 1;
              context.step = 3;
            } else {
              var title = "Witch Device do you want to remove?";
              context.step = 5;
            }

            var respDict = {
              "type": "Interface",
              "interface": "list",
              "title": title,
              "items": names
            };

            context.list = names;
          } else {
            // Error if no device is configured
            var respDict = {
              "type": "Interface",
              "interface": "instruction",
              "title": "Unavailable",
              "detail": "No Device is configured.",
              "showNextButton": true
            };

            context.step = 1;
          }
          callback(respDict);
        }
        break;
      case 3:
        if (context.operation === 0) {
          var data = request.response.inputs;
        } else if (context.operation === 1) {
          var selection = context.list[request.response.selections[0]];
          var data = this.accessories[selection].context;
        }
        
        if (data.name) {
          // Add/Modify info of selected accessory
          var respDict = {
            "type": "Interface",
            "interface": "input",
            "title": data.name,
            "items": [{
              "id": "ip",
              "title": "Ip Address",
              "placeholder": context.operation ? "Leave blank if unchanged" : "192.168.1.2"
            }, {
              "id": "start",
              "title": "HEX Value for Start",
              "placeholder": context.operation ? "Leave blank if unchanged" : "HEX Data"
            }, {
              "id": "stop",
              "title": "HEX Value for Stop",
              "placeholder": context.operation ? "Leave blank if unchanged" : "HEX Data"
            }, {
              "id": "charge",
              "title": "HEX Value for Charge",
              "placeholder": context.operation ? "Leave blank if unchanged" : "HEX Data"
            }, {
              "id": "locate",
              "title": "HEX Value for Locate",
              "placeholder": context.operation ? "Leave blank if unchanged" : "HEX Data"
            }, {
              "id": "manufacturer",
              "title": "Manufacturer",
              "placeholder": context.operation ? "Leave blank if unchanged" : "Default-Manufacturer"
            }, {
              "id": "model",
              "title": "Model",
              "placeholder": context.operation ? "Leave blank if unchanged" : "Default-Model"
            }, {
              "id": "serial",
              "title": "Serial",
              "placeholder": context.operation ? "Leave blank if unchanged" : "Default-SerialNumber"
            }]
          };

          context.name = data.name;
          context.step = 4;
        } else {
          // Error if required info is missing
          var respDict = {
            "type": "Interface",
            "interface": "instruction",
            "title": "Error",
            "detail": "Name of the device is missing.",
            "showNextButton": true
          };
        
          context.step = 1;
        }

        delete context.list;
        delete context.operation;
        callback(respDict);
        break;
      case 4:
        var userInputs = request.response.inputs;
        var newDevice = {};

        // Clone context if device exists
        if (this.accessories[context.name]) {
          newDevice = JSON.parse(JSON.stringify(this.accessories[context.name].context));
        }

        // Setup input for addAccessory
        newDevice.name = context.name;
        newDevice.ip = userInputs.ip || newDevice.ip;
        newDevice.start = userInputs.start || newDevice.start;
        newDevice.stop = userInputs.stop || newDevice.stop;
        newDevice.charge = userInputs.charge || newDevice.charge;
        newDevice.locate = userInputs.locate || newDevice.locate;
        newDevice.manufacturer = userInputs.manufacturer;
        newDevice.model = userInputs.model;
        newDevice.serial = userInputs.serial;

        // Register or update accessory in HomeKit
        this.addAccessory(newDevice);
        var respDict = {
          "type": "Interface",
          "interface": "instruction",
          "title": "Success",
          "detail": "The new device is now updated.",
          "showNextButton": true
        };

        context.step = 6;
        callback(respDict);
        break;
      case 5:
        // Remove selected accessory from HomeKit
        var selection = context.list[request.response.selections[0]];
        var accessory = this.accessories[selection];

        this.removeAccessory(accessory);
        var respDict = {
          "type": "Interface",
          "interface": "instruction",
          "title": "Success",
          "detail": "The device is now removed.",
          "showNextButton": true
        };

        delete context.list;
        context.step = 6;
        callback(respDict);
        break;
      case 6:
        // Update config.json accordingly
        var self = this;
        delete context.step;
        var newConfig = this.config;

        // Create config for each device
        var newDevices = Object.keys(this.accessories).map(function (k) {
          var accessory = self.accessories[k];
          var data = {
            'name': accessory.context.name,
            'ip': accessory.context.ip,
            'start': accessory.context.start,
            'stop': accessory.context.stop,
            'charge': accessory.context.charge,
            'locate': accessory.context.locate,
            'manufacturer': accessory.context.manufacturer,
            'model': accessory.context.model,
            'serial': accessory.context.serial
          };
          return data;
        });

        newConfig.devices = newDevices;
        callback(null, "platform", true, newConfig);
        break;
    }
  }
}
