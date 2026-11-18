import type {API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic} from 'homebridge';
import {FastWarmPlatformConfig, parseFastWarmConfiguration} from './config';
import TuyaDevice, {TuyaDeviceStatus} from './device/TuyaDevice';
import TuyaDeviceManager from './device/TuyaDeviceManager';
import FastWarmLanController from './device/lan/FastWarmLanController';
import {FastWarmLanKeyStore} from './device/lan/FastWarmLanConfiguration';
import {saveFastWarmLanMetadata} from './device/lan/FastWarmLanBootstrap';
import TuyaProgrammeProvider from './device/schedule/TuyaProgrammeProvider';
import ThermostatAccessory from './accessory/ThermostatAccessory';
import {deviceMetadata} from './deviceMetadata';
import {initLogger} from './util/Logger';
import {sanitizeName} from './util/util';

export const PLUGIN_NAME = '@jdipper/homebridge-fastwarm';
export const PLATFORM_NAME = 'FastWarmPlatform';

/** One local device provider. Household programmes and Apple Home switches belong to Heating Programmes. */
export class FastWarmPlatform implements DynamicPlatformPlugin {
  readonly Service: typeof Service;
  readonly Characteristic: typeof Characteristic;
  readonly config: FastWarmPlatformConfig;
  readonly options: {debug?: boolean; debugLevel?: string};
  deviceManager?: TuyaDeviceManager;
  programmeProvider?: TuyaProgrammeProvider;
  private localController?: FastWarmLanController;
  private cachedAccessories: PlatformAccessory[] = [];
  private handlers: ThermostatAccessory[] = [];
  private stopping = false;
  private starting?: Promise<void>;

  constructor(readonly log: Logger, config: PlatformConfig, readonly api: API) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.options = {debug: config.debug === true};
    this.config = config as FastWarmPlatformConfig;
    initLogger(log);
    try {
      this.config = parseFastWarmConfiguration(config);
    } catch {
      log.error('FastWarm setup is invalid. Check the instance ID, ET-63 devices and private local addresses.');
      return;
    }
    api.on('didFinishLaunching', () => {
      void this.start().catch(() => {
        log.error('FastWarm could not start. Check private keys, saved device information and whether another provider is running.');
      });
    });
    api.on('shutdown', () => {
      this.stopping = true; void this.close();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cachedAccessories.push(accessory);
  }

  start(): Promise<void> {
    this.starting ??= this.startOwned().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async startOwned(): Promise<void> {
    if (this.stopping || this.programmeProvider) {
      return;
    }
    const persist = this.api.user.persistPath();
    const metadata = await deviceMetadata(persist, this.config.instanceId, this.config.devices);
    const selections = this.config.devices.filter(device => device.enabled !== false).map(device => ({
      deviceId: device.deviceId, address: device.address, version: device.version, enabled: true,
    }));
    const store = new FastWarmLanKeyStore(persist, this.config.instanceId), keys = new Map<string, string>();
    for (const device of selections) {
      const key = await store.read(device.deviceId);
      if (key) {
        keys.set(device.deviceId, key);
      } else {
        this.log.warn('A FastWarm thermostat needs its private key. Import it on the plugin page and restart this bridge.');
      }
    }
    const manager = new TuyaDeviceManager();
    manager.devices = metadata.devices;
    manager.ownerIDs = [...new Set(metadata.devices.map(device => device.owner_id))];
    const local = new FastWarmLanController(selections, keys);
    manager.setFastWarmLan(local);
    const provider = new TuyaProgrammeProvider(manager, persist, this.config.instanceId);
    this.deviceManager = manager;
    this.localController = local;
    try {
      // The legacy-compatible owner lock excludes the old Tuya provider before opening any thermostat socket.
      await provider.start();
      this.programmeProvider = provider;
      if (this.stopping) {
        await this.close(); return;
      }
      if (metadata.saveNeeded) {
        await saveFastWarmLanMetadata(persist, this.config.instanceId, metadata.cache);
      }
      await local.start(metadata.devices);
      if (this.stopping) {
        await this.close(); return;
      }
      manager.on(TuyaDeviceManager.Events.DEVICE_STATUS_UPDATE, this.updateStatus);
      manager.on(TuyaDeviceManager.Events.DEVICE_INFO_UPDATE, this.updateInfo);
      for (const device of metadata.devices) {
        this.addAccessory(device);
      }
      // Unmatched cached accessories are retained for an explicit migration review, never silently retired.
      this.log.info('FastWarm Local is ready. Startup made no cloud requests or heating-setting changes.');
    } catch (error) {
      await provider.close().catch(() => undefined);
      local.close();
      this.programmeProvider = undefined;
      throw error;
    }
  }

  private addAccessory(device: TuyaDevice): void {
    const uuid = this.api.hap.uuid.generate(device.id);
    const cached = this.cachedAccessories.find(accessory => accessory.UUID === uuid);
    const accessory = cached ?? new this.api.platformAccessory(sanitizeName(device.name) ?? 'FastWarm thermostat', uuid);
    accessory.context.deviceID = device.id;
    const handler = new ThermostatAccessory(this, accessory);
    if (!handler.checkRequirements()) {
      throw new Error('The configured thermostat model is unavailable.');
    }
    handler.configureServices();
    handler.configureStatusActive();
    handler.updateAllValues();
    handler.intialized = true;
    this.handlers.push(handler);
    if (cached) {
      this.api.updatePlatformAccessories([accessory]);
    } else {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  private updateStatus = (device: TuyaDevice, status: TuyaDeviceStatus[]): void => {
    this.handlers.find(handler => handler.device.id === device.id)?.onDeviceStatusUpdate(status);
  };

  private updateInfo = (device: TuyaDevice, info: unknown): void => {
    this.handlers.find(handler => handler.device.id === device.id)?.onDeviceInfoUpdate(info);
  };

  async close(): Promise<void> {
    this.stopping = true;
    if (this.deviceManager) {
      this.deviceManager.removeListener(TuyaDeviceManager.Events.DEVICE_STATUS_UPDATE, this.updateStatus);
      this.deviceManager.removeListener(TuyaDeviceManager.Events.DEVICE_INFO_UPDATE, this.updateInfo);
    }
    this.localController?.close();
    await this.programmeProvider?.close().catch(() => this.log.warn('FastWarm shutdown needs attention.'));
    this.programmeProvider = undefined;
  }
}
