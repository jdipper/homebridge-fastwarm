/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { PlatformAccessory, Service, Characteristic, Nullable, CharacteristicValue } from 'homebridge';

import { TuyaDeviceSchemaMode, TuyaDeviceStatus } from '../device/TuyaDevice';
import type TuyaDevice from '../device/TuyaDevice';
import type TuyaDeviceManager from '../device/TuyaDeviceManager';
import type { FastWarmPlatform } from '../platform';
import { sanitizeName } from '../util/util';
import { logger, PrefixLogger } from '../util/Logger';
import {isFastWarmThermostat} from '../device/profile/FastWarmThermostat';

const MANUFACTURER = 'Tuya Inc.';

/**
 * Homebridge Accessory Categories Documentation:
 *   https://developers.homebridge.io/#/categories
 * Tuya Standard Instruction Set Documentation:
 *   https://developer.tuya.com/en/docs/iot/standarddescription?id=K9i5ql6waswzq
 */
export default class BaseAccessory {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public deviceManager: TuyaDeviceManager;
  public device: TuyaDevice;
  public log: PrefixLogger;

  public intialized: boolean;

  supportedDPs: Set<string>;

  constructor(
    public readonly platform: FastWarmPlatform,
    public readonly accessory: PlatformAccessory,
  ) {
    this.Service = this.platform.api.hap.Service;
    this.Characteristic = this.platform.api.hap.Characteristic;
    this.deviceManager = this.platform.deviceManager!;
    this.device = this.deviceManager.getDevice(this.accessory.context.deviceID)!;
    this.log = new PrefixLogger(
      logger(),
      this.device.name.length > 0 ? this.device.name : this.device.id,
      this.platform.config.debug === true,
    );
    this.intialized = false;
    this.supportedDPs = new Set();
    this.addAccessoryInfoService();
  }

  addAccessoryInfoService() {
    const service = this.accessory.getService(this.Service.AccessoryInformation)
      || this.accessory.addService(this.Service.AccessoryInformation);

    const safeName = sanitizeName(this.device.name) ?? (this.device.id || 'Tuya Device');
    service
      .setCharacteristic(this.Characteristic.Manufacturer, MANUFACTURER)
      .setCharacteristic(this.Characteristic.Model, this.device.model || this.device.product_name || this.device.product_id)
      .setCharacteristic(this.Characteristic.Name, safeName)
      .setCharacteristic(this.Characteristic.ConfiguredName, safeName)
      .setCharacteristic(this.Characteristic.SerialNumber, this.device.uuid)
    ;
  }

  configureStatusActive() {
    for (const service of this.accessory.services) {
      if (!service.testCharacteristic(this.Characteristic.StatusActive)) { // silence warning
        service.addOptionalCharacteristic(this.Characteristic.StatusActive);
      }
      service.getCharacteristic(this.Characteristic.StatusActive)
        .onGet(() => this.device.online);
    }
  }

  async updateAllValues() {
    for (const service of this.accessory.services) {
      for (const characteristic of service.characteristics) {
        if (characteristic.UUID === this.Characteristic.ProgrammableSwitchEvent.UUID) {
          continue;
        }

        let newValue: Nullable<CharacteristicValue> | Error = characteristic.value;
        const getHandler = characteristic['getHandler'];
        if (getHandler) {
          try {
            newValue = await getHandler();
          } catch (error) {
            // TODO: why `characteristic.updateValue(HapStatusError)` not working?
            // newValue = error as Error;
            continue;
          }
        }

        if (characteristic.value !== newValue && !(newValue instanceof Error)) {
          this.log.debug(
            '[%s/%s/%s] Update value: %o => %o',
            service.constructor.name,
            service.subtype,
            characteristic.constructor.name,
            characteristic.value,
            newValue,
          );
        }
        characteristic.updateValue(newValue);
      }
    }
  }

  checkOnlineStatus() {
    if (!this.device.online) {
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  getSchema(...codes: string[]) {
    for (const code of codes) {
      const schema = this.device.schema.find(schema => {
        // ignore case
        return schema.code.toLowerCase() === code.toLowerCase();
      });

      if (!schema) {
        continue;
      }

      // Readable schema must have a status
      if (!isFastWarmThermostat(this.device) && [TuyaDeviceSchemaMode.READ_WRITE, TuyaDeviceSchemaMode.READ_ONLY].includes(schema.mode)
        && !this.getStatus(schema.code)) {
        this.log.warn('no status');
        continue;
      }

      this.supportedDPs.add(schema.code);
      return schema;
    }
    return undefined;
  }

  getStatus(code: string) {
    return this.device.status.find(status => status.code === code);
  }

  async sendCommands(commands: TuyaDeviceStatus[]) {
    if (commands.length === 0) {
      return;
    }

    commands = commands.filter((status) => status.code && status.value !== undefined);

    if (this.device.online === false) {
      this.log.warn('Device is offline, skip send command.');
      this.updateAllValues();
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      return;
    }

    // Update cache immediately
    for (const newStatus of commands) {
      const oldStatus = this.device.status.find(_status => _status.code === newStatus.code);
      if (oldStatus) {
        oldStatus.value = newStatus.value;
      }
    }

    return await this.deviceManager.sendCommands(this.device.id, commands);
  }

  checkRequirements() {
    let result = true;
    for (const codes of this.requiredSchema()) {
      const schema = this.getSchema(...codes);
      if (schema) {
        continue;
      }
      this.log.warn('Product Category: %s', this.device.category);
      this.log.warn('Missing one of the required schema: %s', codes);
      this.log.warn('The saved thermostat metadata does not provide the required control.');
      result = false;
    }

    if (!result) {
      this.log.warn('Existing schema: %o', this.device.schema);
    }

    return result;
  }

  requiredSchema(): string[][] {
    return [];
  }

  configureServices() {
    //
  }

  configureDeviceSpecificFeatures() {
    //
  }

  async onDeviceInfoUpdate(info) {
    this.updateAllValues();
  }

  async onDeviceStatusUpdate(status: TuyaDeviceStatus[]) {
    this.updateAllValues();
  }

}
