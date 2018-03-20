/* exported homebridge */
/* eslint-env node */
const Noble = require('noble');
const binstruct = require('binstruct');

let Service;
let Characteristic;

const COMETBLUE_SERVICE = '47e9ee0047e911e48939164230d1df67';
const COMETBLUE_TEMPERATURES_CHARACTERISTIC = '47e9ee2b47e911e48939164230d1df67';
const COMETBLUE_PIN_CHARACTERISTIC = '47e9ee3047e911e48939164230d1df67';
const DEFAULT_PIN = '000000';
const DEFAULT_NAME = 'Thermostat';
const MIN_TEMP = 7;
const MAX_TEMP = 25;

class CometBlueAccessory {
  constructor(log, config) {
    this.log = log;

    this.name = config.name || DEFAULT_NAME;
    this.address = config.address;
    this.pin = config.pin || DEFAULT_PIN;

    this.minTemp = config.minTemp || MIN_TEMP;
    this.maxTemp = config.maxTemp || MAX_TEMP;
    this.tempStep = 0.5;

    // device state - refreshed on temperature get/set
    this.state = {
      current: 0,
      target: 0,
      offset: 0,
      comfort: 0,
      economy: 0,
      windowTime: 0,
      windowSens: 0,
    };

    // Noble
    this.nobleCharacteristic = null;
    Noble.on('stateChange', this.nobleStateChange.bind(this));
    // Array for keeping track of callback objects
    this.readCallbacks = [];
    this.temperaturesCharacteristic = null;

    // Characteristics configuration
    this.thermostatService = new Service.Thermostat(this.name);

    this.thermostatService.addCharacteristic(Characteristic.BatteryLevel);

    this.thermostatService
      .getCharacteristic(Characteristic.BatteryLevel)
      .on('get', this.getBatteryLevel.bind(this));

    this.thermostatService
      .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .on('get', this.getCoolingHeatingState.bind(this));

    this.thermostatService
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .on('set', this.setTargetCoolingHeatingState.bind(this))
      .on('get', this.getTargetCoolingHeatingState.bind(this));

    this.thermostatService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', this.getCurrentTemperature.bind(this));

    this.thermostatService
      .getCharacteristic(Characteristic.TargetTemperature)
      .on('set', this.setTargetTemperature.bind(this))
      .on('get', this.getTargetTemperature.bind(this));

    this.thermostatService
      .getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .on('set', this.setTemperatureDisplayUnits.bind(this))
      .on('get', this.getTemperatureDisplayUnits.bind(this));

    this.informationService = new Service.AccessoryInformation();

    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, 'CometBlue')
      .setCharacteristic(Characteristic.Model, 'Thermostat')
      .setCharacteristic(Characteristic.SerialNumber, this.address);
  }

  getServices() {
    return [this.informationService, this.thermostatService];
  }

  identify(callback) {
    this.log('Identify requested!');
    callback(false);
  }

  // Characteristic setters and getters
  getBatteryLevel(callback) {
    this.log('getBatteryLevel()');
    callback(false, 50);
  }

  getCoolingHeatingState(callback) {
    this.log('getCoolingHeatingState()');
    callback(false, Characteristic.CurrentHeatingCoolingState.HEAT);
  }

  setTargetCoolingHeatingState(value, callback) {
    this.log(`setTargetCoolingHeatingState(${value})`);
    callback(false, Characteristic.TargetHeatingCoolingState.HEAT);
  }

  getTargetCoolingHeatingState(callback) {
    this.log('getTargetCoolingHeatingState()');
    callback(false, Characteristic.TargetHeatingCoolingState.HEAT);
  }

  getCurrentTemperature(callback) {
    this.log('getCurrentTemperature()');
    this.readFromDevice((error) => { this.log('read target: ', this.state); callback(error, this.state.current); });
  }

  setTargetTemperature(value, callback) {
    this.log(`setTargetTemperature(${value})`);
    this.state.target = value;
    this.writeToDevice(callback);
  }

  getTargetTemperature(callback) {
    this.log('getTargetTemperature()');
    this.readFromDevice((error) => { this.log('read target: ', this.state); callback(error, this.state.target); });
  }

  setTemperatureDisplayUnits(value, callback) {
    this.log(`setTemperatureDisplayUnits(${value})`);
    callback(false, Characteristic.TemperatureDisplayUnits.CELSIUS);
  }

  getTemperatureDisplayUnits(callback) {
    this.log('getTemperatureDisplayUnits()');
    callback(false, Characteristic.TemperatureDisplayUnits.CELSIUS);
  }

  readFromDevice(callback) {
    if (this.temperaturesCharacteristic == null) {
      this.log.warn('Characteristic not yet found. Skipping..');
      callback(false);
      return;
    }

    this.readCallbacks.push(callback);

    if (this.readCallbacks.length > 1) {
      this.log(`Outstanding "readFromDevice" request already active.
Adding callback to queue. (${this.readCallbacks.length})`);
    } else {
      this.log('No callback queue, sending "read" call to nobleCharacteristic');

      this.temperaturesCharacteristic.read((error, buffer) => {
        this.log('Executing noble "read" callback');
        if (error === null) {
          this.log('Got success response from characteristic');
        } else {
          this.log(`Read from bluetooth characteristic failed: ${error}`);
        }

        this.log('buffer:', buffer);

        this.state = {
          current: buffer[0] / 2,
          target: buffer[1] / 2,
          economy: buffer[2] / 2,
          comfort: buffer[3] / 2,
          offset: buffer[4] / 2,
          windowSens: buffer[5] / 2,
          windowTime: buffer[6] / 2,
        };

        this.log(`Sending result to ${this.readCallbacks.length} queued callbacks`);
        this.readCallbacks.forEach((queuedCallback) => {
          queuedCallback(error);
        });
        this.log('Clearing callback queue');
        this.readCallbacks = [];
      });
    }
  }

  writeToDevice(callback) {
    if (this.temperaturesCharacteristic == null) {
      this.log.warn('Characteristic not yet found. Skipping..');
      callback(false);
      return;
    }

    const buffer = Buffer.alloc(7);
    binstruct
      .def({ littleEndian: true })
      .int8(-127)
      .int8(this.state.target * 2)
      .int8(this.state.economy * 2)
      .int8(this.state.comfort * 2)
      .int8(this.state.offset * 2)
      .int8(this.state.windowSens)
      .int8(this.state.windowTime)
      .wrap(buffer)
      .writeValues();

    this.temperaturesCharacteristic.write(buffer, false);
    callback();
  }

  // Noble handling
  nobleStateChange(state) {
    if (state === 'poweredOn') {
      this.log.info('Starting Noble scan..');
      Noble.startScanning([COMETBLUE_SERVICE], false);
      Noble.on('discover', this.nobleDiscovered.bind(this));
    } else {
      this.log.info(`Noble state change to ${state}; stopping scan.`);
      Noble.stopScanning();
    }
  }

  nobleDiscovered(accessory) {
    if (accessory.address === this.address) {
      this.log.info(`Found accessory for ${this.name}, connecting..`);
      accessory.connect((error) => {
        this.nobleConnected(error, accessory);
      });
      // accessory.discoverServices([COMETBLUE_SERVICE], this.nobleServicesDiscovered.bind(this));
    } else {
      this.log(`Found non-matching accessory ${accessory.address}`);
    }
    return accessory;
  }

  writePin(service) {
    const pin = binstruct
      .def({ littleEndian: true })
      .uint32(this.pin)
      .write();

    service.discoverCharacteristics([COMETBLUE_PIN_CHARACTERISTIC], (error, characteristics) => {
      const pinCharacteristic = characteristics[0];
      this.log('discovered pin characteristic:', error);

      // true if for write without response
      pinCharacteristic.write(pin, false, (pinError) => {
        this.log('pin set:', pinError);
        service.discoverCharacteristics(
          [COMETBLUE_TEMPERATURES_CHARACTERISTIC],
          this.nobleCharacteristicsDiscovered.bind(this),
        );
      });
    });
  }

  nobleConnected(error, accessory) {
    if (error) return this.log.error(`Noble connection failed: ${error}`);
    this.log.info('Connection success, discovering services..');
    Noble.stopScanning();
    accessory.discoverServices([COMETBLUE_SERVICE], this.nobleServicesDiscovered.bind(this));
    accessory.on('disconnect', (connectionError) => {
      this.nobleDisconnected(connectionError, accessory);
    });

    return accessory;
  }

  nobleDisconnected(error, accessory) {
    this.log.info(`Disconnected from ${accessory.address}: ${error || '(No error)'}`);
    accessory.removeAllListeners('disconnect');
    this.log.info('Restarting Noble scan..');
    Noble.startScanning([COMETBLUE_SERVICE], false);
    return accessory;
  }

  nobleServicesDiscovered(error, services) {
    if (error) return this.log.error(`Noble services discovery failed: ${error}`);
    const service = services[0];
    // services.forEach((service) => {
    this.writePin(service);
    // });
    return services;
  }

  nobleCharacteristicsDiscovered(error, characteristics) {
    if (error) return this.log.error(`Noble characteristic discovery failed: ${error}`);
    characteristics.forEach((characteristic) => {
      if (characteristic.uuid === COMETBLUE_TEMPERATURES_CHARACTERISTIC) {
        this.log.info(`Found Temperatures Characteristic: ${characteristic.uuid}`);
        this.temperaturesCharacteristic = characteristic;
        Noble.stopScanning();
      }
    });
    return characteristics;
  }
}

module.exports = (homebridge) => {
  ({ Service, Characteristic } = homebridge.hap);

  homebridge.registerAccessory('homebridge-cometblue', 'CometBlue', CometBlueAccessory);
};
