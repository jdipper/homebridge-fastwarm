import type {PlatformConfig} from 'homebridge';
import {randomBytes} from 'crypto';
import type {FastWarmLocalDeviceConfig} from './device/lan/FastWarmLanConfiguration';
import {parseFastWarmLocalDevices} from './device/lan/FastWarmLanConfiguration';
import type {TuyaDeviceSchemaProperty, TuyaDeviceSchemaType} from './device/TuyaDevice';

export interface FastWarmDeviceConfig extends FastWarmLocalDeviceConfig {
  model?: 'ET-63';
  name?: string;
  roomName?: string;
}

/** Optional metadata import only. These credentials never enter the native runtime. */
export interface SmartLifeOptions {
  projectType: '2';
  endpoint?: string;
  accessId: string;
  accessKey: string;
  countryCode: number;
  username: string;
  password: string;
  appSchema: string;
  homeWhitelist?: number[];
  forceIPv4?: boolean;
}

export interface FastWarmPlatformConfig extends PlatformConfig {
  instanceId: string;
  devices: FastWarmDeviceConfig[];
  smartLife?: SmartLifeOptions;
  debug?: boolean;
}

// Internal type aliases retained for the separately loaded, reviewed metadata importer.
export type TuyaPlatformConfigOptions = SmartLifeOptions;
export type TuyaPlatformHomeConfigOptions = SmartLifeOptions;
export interface TuyaPlatformDeviceSchemaConfig {
  code: string; newCode?: string; type?: TuyaDeviceSchemaType; property?: TuyaDeviceSchemaProperty;
  hidden?: boolean; extra?: boolean;
}
export interface TuyaPlatformDeviceConfig {id: string; schema?: TuyaPlatformDeviceSchemaConfig[]}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Object.getOwnPropertyDescriptor(value, key)!.enumerable
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value')));
}

export function newInstanceId(): string {
  return randomBytes(8).toString('hex');
}

/** Do not let account fields, inline keys, prototype getters or generic device overrides enter the LAN configuration. */
export function parseFastWarmConfiguration(value: unknown): FastWarmPlatformConfig {
  try {
    if (!record(value) || Object.keys(value).some(key =>
      !['platform', 'plugin', 'name', '_bridge', 'instanceId', 'devices', 'smartLife', 'debug'].includes(key))
      || value.platform !== 'FastWarmPlatform' || typeof value.instanceId !== 'string'
      || !/^[a-f0-9]{16}$/.test(value.instanceId) || !Array.isArray(value.devices)
      || value.devices.length < 1 || value.devices.length > 64
      || (value.debug !== undefined && typeof value.debug !== 'boolean')) {
      throw new Error();
    }
    const devices = value.devices.map(item => {
      if (!record(item) || Object.keys(item).some(key =>
        !['deviceId', 'address', 'version', 'enabled', 'model', 'name', 'roomName'].includes(key))
        || item.model !== undefined && item.model !== 'ET-63') {
        throw new Error();
      }
      for (const field of ['name', 'roomName']) {
        if (item[field] !== undefined && (typeof item[field] !== 'string' || !(item[field] as string).trim()
          || (item[field] as string).length > 256 || (item[field] as string).includes('\0'))) {
          throw new Error();
        }
      }
      const {model: _model, name: _name, roomName: _room, ...selection} = item;
      void _model; void _name; void _room;
      return {...parseFastWarmLocalDevices([selection])[0]!, model: 'ET-63' as const,
        ...(item.name === undefined ? {} : {name: (item.name as string).trim()}),
        ...(item.roomName === undefined ? {} : {roomName: (item.roomName as string).trim()})};
    });
    parseFastWarmLocalDevices(devices.map(({model, name, roomName, ...device}) => {
      void model; void name; void roomName; return device;
    }));
    if (!devices.some(device => device.enabled !== false)) {
      throw new Error();
    }
    // SmartLife is optional and is validated by the explicit import action, never used during startup.
    if (value.smartLife !== undefined && !record(value.smartLife)) {
      throw new Error();
    }
    return {...value, devices} as unknown as FastWarmPlatformConfig;
  } catch {
    throw new Error('FastWarm setup needs a stable instance ID and enabled ET-63 devices with private IPv4 addresses and protocol 3.5.');
  }
}
