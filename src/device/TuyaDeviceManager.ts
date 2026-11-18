import EventEmitter from 'events';
import TuyaOpenAPI from '../core/TuyaOpenAPI';
import TuyaOpenMQ from '../core/TuyaOpenMQ';
import {ExLogger, logger, PrefixLogger} from '../util/Logger';
import TuyaDevice, {TuyaDeviceStatus} from './TuyaDevice';
import {FastWarmLanTransport} from './lan/FastWarmLanTransport';
import {isFastWarmLanCommand} from './lan/FastWarmLanClient';
import {FASTWARM_CURRENT_TEMPERATURE_SCHEMA, getFastWarmSetTemperatureReport,
  getFastWarmTemperatureReport, isFastWarmThermostat} from './profile/FastWarmThermostat';

enum Events {
  DEVICE_ADD = 'DEVICE_ADD',
  DEVICE_INFO_UPDATE = 'DEVICE_INFO_UPDATE',
  DEVICE_STATUS_UPDATE = 'DEVICE_STATUS_UPDATE',
  DEVICE_DELETE = 'DEVICE_DELETE',
  THERMOSTAT_OBSERVATION = 'THERMOSTAT_OBSERVATION',
}

export interface ThermostatTemperatureObservation {
  value: number;
  reportedAt?: number;
  receivedAt: number;
  source: 'lan';
}

/** Native ET-63 inventory and observations. The API/MQ members are inert compatibility seams. */
export default class TuyaDeviceManager extends EventEmitter {
  static readonly Events = Events;
  public devices: TuyaDevice[] = [];
  public ownerIDs: string[] = [];
  public mq: TuyaOpenMQ;
  public log: ExLogger;
  public fastWarmLan?: FastWarmLanTransport;
  private readonly observations = new Map<string, ThermostatTemperatureObservation>();
  private readonly measurementGenerations = new Map<string, number>();
  private readonly celsiusGenerations = new Map<string, number>();
  private readonly latestReportAt = new Map<string, number>();
  private readonly disconnectedAt = new Map<string, number>();

  constructor(public api = new TuyaOpenAPI(), debug = false) {
    super();
    this.log = new PrefixLogger(logger(), TuyaDeviceManager.name, debug);
    this.mq = new TuyaOpenMQ(api);
  }

  getDevice(deviceID: string): TuyaDevice | undefined {
    return this.devices.find(device => device.id === deviceID);
  }

  async refreshDeviceRooms(): Promise<void> {
    // Room metadata comes from the explicit, private enrollment inventory.
  }

  async refreshSupplementalTemperature(_device: TuyaDevice): Promise<void> {
    // Reads consume accepted observations; only the owned controller polls the LAN.
    void _device;
  }

  async onMQTTMessage(..._args: unknown[]): Promise<void> {
    // Stale callers cannot reintroduce cloud state into the local provider.
    void _args;
  }

  async enrichDeviceStatus(device: TuyaDevice): Promise<void> {
    if (!isFastWarmThermostat(device)) {
      device.online = false;
      return;
    }
    if (!device.schema.some(item => item.code === 'temp_current')) {
      device.schema.push({...FASTWARM_CURRENT_TEMPERATURE_SCHEMA,
        property: {...FASTWARM_CURRENT_TEMPERATURE_SCHEMA.property as object}});
    }
    const accepted = this.getTemperatureObservation(device.id);
    if (!accepted) {
      device.status = device.status.filter(item => item.code !== 'temp_current');
    } else {
      const current = device.status.find(item => item.code === 'temp_current');
      if (current) {
        current.value = accepted.value;
      } else {
        device.status.push({code: 'temp_current', value: accepted.value});
      }
    }
    device.online = Boolean(this.fastWarmLan?.isConnected(device.id) && this.latestReportAt.has(device.id));
  }

  getTemperatureObservation(deviceId: string): ThermostatTemperatureObservation | undefined {
    const observation = this.observations.get(deviceId);
    return observation && {...observation};
  }

  isTemperatureAvailable(deviceId: string): boolean {
    const device = this.getDevice(deviceId), local = this.fastWarmLan;
    return Boolean(device && isFastWarmThermostat(device) && local?.has(deviceId) && local.isConnected(deviceId)
      && this.observations.has(deviceId) && this.measurementGenerations.get(deviceId) === local.generation(deviceId)
      && this.celsiusGenerations.get(deviceId) === local.generation(deviceId)
      && device.status.some(item => item.code === 'temp_unit_convert' && item.value === 'c'));
  }

  setFastWarmLan(transport: FastWarmLanTransport): void {
    if (this.fastWarmLan) {
      throw new Error('The local thermostat connection already has an owner.');
    }
    this.fastWarmLan = transport;
    for (const device of this.devices) {
      if (isFastWarmThermostat(device) && transport.has(device.id)) {
        device.online = false;
      }
    }
    transport.addRawMessageListener((_topic, protocol, message, receivedAt) => {
      const device = this.getDevice(message.devId), generation = transport.generation(message.devId);
      if (protocol !== 4 || message.source !== 'lan' || !device || !isFastWarmThermostat(device)
        || !transport.has(device.id) || !transport.isConnected(device.id) || !Array.isArray(message.status)
        || !message.status.every(item => item && typeof item === 'object')
        || !Number.isSafeInteger(receivedAt) || receivedAt <= 0 || receivedAt > Date.now() + 5000
        || receivedAt < (this.latestReportAt.get(device.id) ?? 0)
        || receivedAt < (this.disconnectedAt.get(device.id) ?? 0)) {
        return;
      }
      this.latestReportAt.set(device.id, receivedAt);
      device.online = true;
      const changed: TuyaDeviceStatus[] = [];
      const set = (code: string, value: string | number | boolean) => {
        const previous = device.status.find(item => item.code === code);
        if (previous?.value === value) {
          return;
        }
        if (previous) {
          previous.value = value;
        } else {
          device.status.push({code, value});
        }
        changed.push({code, value});
      };
      const unit = message.status.find(item => item.dp_id === 107)?.value;
      if (typeof unit === 'boolean') {
        set('temp_unit_convert', unit ? 'f' : 'c');
        if (unit) {
          this.celsiusGenerations.delete(device.id);
          this.measurementGenerations.delete(device.id);
        } else {
          this.celsiusGenerations.set(device.id, generation);
        }
      }
      for (const property of message.status) {
        if (property.dp_id === 101 && typeof property.value === 'boolean') {
          set('switch', property.value);
        } else if (property.dp_id === 108 && typeof property.value === 'boolean') {
          set('child_lock', property.value);
        } else if (property.dp_id === 103 && ['smart', 'hold', 'holiday'].includes(String(property.value))) {
          set('mode', String(property.value));
        } else if (property.dp_id === 110 && typeof property.value === 'number' && Number.isSafeInteger(property.value)
          && property.value >= 0) {
          set('Event_Adaptive_Set', property.value);
        }
      }
      if (this.celsiusGenerations.get(device.id) === generation) {
        const target = message.status.map(getFastWarmSetTemperatureReport).find(value => value !== undefined);
        if (target) {
          set('temp_set', target.value);
        }
        const room = message.status.map(getFastWarmTemperatureReport).find(value => value !== undefined);
        if (room) {
          set('temp_current', room.value);
          this.observations.set(device.id, {value: room.value, receivedAt, source: 'lan'});
          this.measurementGenerations.set(device.id, generation);
          this.emit(Events.THERMOSTAT_OBSERVATION, device, this.getTemperatureObservation(device.id));
        }
      }
      if (changed.length) {
        this.emit(Events.DEVICE_STATUS_UPDATE, device, changed);
      }
    });
    transport.addConnectionListener(event => {
      const device = this.getDevice(event.deviceId);
      if (!device || !isFastWarmThermostat(device) || !transport.has(event.deviceId)
        || event.generation !== transport.generation(event.deviceId)) {
        return;
      }
      device.online = event.connected;
      if (!event.connected) {
        this.disconnectedAt.set(device.id, Date.now());
        this.celsiusGenerations.delete(device.id);
        this.measurementGenerations.delete(device.id);
      }
      this.emit(Events.DEVICE_INFO_UPDATE, device);
    });
  }

  async sendCommands(deviceID: string, commands: TuyaDeviceStatus[]): Promise<boolean> {
    const local = this.fastWarmLan, device = this.getDevice(deviceID);
    if (!device || !isFastWarmThermostat(device) || !local?.has(deviceID) || !local.isConnected(deviceID)) {
      throw new Error('The local thermostat is unavailable.');
    }
    const properties: Record<string, string | number | boolean> = {}, dps: Record<string, unknown> = {};
    const codes: Record<string, [string, string]> = {
      switch: ['power1', '101'], temp_set: ['SetTemp', '102'], child_lock: ['Lock', '108'], mode: ['ControlMode', '103'],
    };
    for (const command of commands) {
      const code = codes[command.code];
      if (!code || Object.hasOwn(properties, code[0])) {
        throw new Error('This command is not supported by the local thermostat connection.');
      }
      properties[code[0]] = command.value;
      dps[code[1]] = command.value;
    }
    if (!isFastWarmLanCommand(dps)) {
      throw new Error('This command is not supported by the local thermostat connection.');
    }
    const before = await local.readProperties(deviceID, ['TemperUnitChange']);
    if (before.properties.find(item => item.code === 'TemperUnitChange')?.value !== false) {
      throw new Error('Local thermostat commands require Celsius.');
    }
    await local.issueOnce(deviceID, properties, {shouldProceed: () => local.isConnected(deviceID)
      && local.generation(deviceID) === before.generation});
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const readback = await local.readProperties(deviceID, [...Object.keys(properties), 'TemperUnitChange']).catch(() => {
        throw new Error('The local command outcome could not be verified. Do not automatically retry.');
      });
      if (readback.generation !== before.generation) {
        break;
      }
      if (readback.properties.find(item => item.code === 'TemperUnitChange')?.value !== false) {
        throw new Error('The local thermostat units changed before verification. Do not automatically retry.');
      }
      if (Object.entries(properties).every(([code, value]) => readback.properties.find(item => item.code === code)?.value === value)) {
        return true;
      }
    }
    throw new Error('The local command outcome could not be verified. Do not automatically retry.');
  }
}
