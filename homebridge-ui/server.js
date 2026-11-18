'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- Homebridge launches this CommonJS entry point directly. */

const fs = require('node:fs/promises');
const {constants} = require('node:fs');
const path = require('node:path');

const PLUGIN = '@jdipper/homebridge-fastwarm';
const MAX_CONFIG_BYTES = 1024 * 1024;
const ERROR_MESSAGE = 'Local connection setup is unavailable. Check FastWarm settings and Homebridge file permissions.';

function unavailable() {
  return new Error(ERROR_MESSAGE);
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

/** Explicit instance IDs preserve the private key and shared-provider namespace during migration. */
function instanceIdForPlatform(platform) {
  if (!record(platform) || typeof platform.instanceId !== 'string' || !/^[a-f0-9]{16}$/.test(platform.instanceId)) {
    throw unavailable();
  }
  return platform.instanceId;
}

function configuredInstances(configuration, parseDevices) {
  try {
    if (!record(configuration) || !Array.isArray(configuration.platforms)) {
      throw unavailable();
    }
    const configured = [], instances = new Set();
    for (const platform of configuration.platforms) {
      if (!record(platform) || platform.platform !== 'FastWarmPlatform'
        || platform.plugin !== undefined && platform.plugin !== PLUGIN) {
        continue;
      }
      if (!Array.isArray(platform.devices)) {
        throw unavailable();
      }
      const selections = platform.devices.map(device => {
        const allowed = ['deviceId', 'address', 'version', 'enabled', 'name', 'roomName', 'model'];
        if (!record(device) || Reflect.ownKeys(device).some(key => !allowed.includes(key))
          || ['name', 'roomName'].some(key => device[key] !== undefined && (typeof device[key] !== 'string'
            || !device[key].trim() || device[key].length > 256 || device[key].includes('\0')))
          || device.model !== undefined && device.model !== 'ET-63') {
          throw unavailable();
        }
        return {deviceId: device.deviceId, address: device.address, version: device.version,
          ...(device.enabled === undefined ? {} : {enabled: device.enabled})};
      });
      const local = parseDevices(selections);
      if (platform.smartLife !== undefined && !record(platform.smartLife)) {
        throw unavailable();
      }
      const instanceId = instanceIdForPlatform(platform);
      if (instances.has(instanceId)) {
        throw unavailable();
      }
      instances.add(instanceId);
      configured.push({instanceId, options: platform.smartLife, names: platform.devices.map(device => ({deviceId: device.deviceId,
        ...(device.name === undefined ? {} : {name: device.name}), ...(device.roomName === undefined ? {} : {roomName: device.roomName}),
      })), devices: local.map(device => ({
        instanceId, deviceId: device.deviceId, address: device.address,
        version: device.version, enabled: device.enabled !== false,
      }))});
    }
    return configured;
  } catch {
    throw unavailable();
  }
}

function configuredDevices(configuration, parseDevices) {
  return configuredInstances(configuration, parseDevices).flatMap(instance => instance.devices);
}

function contextPaths(context) {
  if (typeof context.storagePath !== 'string' || !path.isAbsolute(context.storagePath)
    || context.storagePath.includes('\0') || context.storagePath.split(path.sep).includes('..')) {
    throw unavailable();
  }
  const configPath = context.configPath ?? path.join(context.storagePath, 'config.json');
  if (typeof configPath !== 'string' || !path.isAbsolute(configPath) || configPath.includes('\0')
    || configPath.split(path.sep).includes('..')) {
    throw unavailable();
  }
  return {configPath, persistPath: path.join(context.storagePath, 'persist')};
}

async function readConfiguration(configPath) {
  try {
    if (!constants.O_NOFOLLOW) {
      throw unavailable();
    }
    const parent = await fs.lstat(path.dirname(configPath));
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.mode & 0o022
      || (typeof process.getuid === 'function' && parent.uid !== process.getuid())) {
      throw unavailable();
    }
    const handle = await fs.open(configPath, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_CONFIG_BYTES || info.mode & 0o022
        || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
        throw unavailable();
      }
      const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
      let length = 0;
      while (length <= MAX_CONFIG_BYTES) {
        const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) {
          break;
        }
        length += bytesRead;
      }
      if (length > MAX_CONFIG_BYTES) {
        throw unavailable();
      }
      return JSON.parse(buffer.subarray(0, length).toString('utf8'));
    } finally {
      await handle.close();
    }
  } catch {
    throw unavailable();
  }
}

function createLocalSetupHandlers(context, dependencies) {
  // Tests inject the same TypeScript helper; installed Homebridge uses the compiled module.
  const helpers = () => dependencies ?? require('../dist/device/lan/FastWarmLanConfiguration');
  async function selected() {
    const {configPath, persistPath} = contextPaths(context);
    const configuration = await readConfiguration(configPath);
    const instances = configuredInstances(configuration, helpers().parseFastWarmLocalDevices);
    return {persistPath, instances, devices: instances.flatMap(instance => instance.devices)};
  }
  return {
    '/local/devices': async payload => {
      try {
        if (payload !== undefined && (!record(payload) || Reflect.ownKeys(payload).length)) {
          throw unavailable();
        }
        const {persistPath, devices} = await selected();
        return {devices: await Promise.all(devices.map(async device => ({...device,
          keyStored: await new (helpers().FastWarmLanKeyStore)(persistPath, device.instanceId).has(device.deviceId),
        })))};
      } catch {
        throw unavailable();
      }
    },
    '/local/instances': async payload => {
      try {
        if (payload !== undefined && (!record(payload) || Reflect.ownKeys(payload).length)) {
          throw unavailable();
        }
        const {instances} = await selected();
        return {instances: instances.map(instance => ({instanceId: instance.instanceId,
          localOnly: true,
          cloudRefreshAvailable: Boolean(instance.options),
          deviceCount: instance.devices.filter(device => device.enabled).length,
        }))};
      } catch {
        throw unavailable();
      }
    },
    '/local/names': async payload => {
      try {
        if (payload !== undefined && (!record(payload) || Reflect.ownKeys(payload).length)) {
          throw unavailable();
        }
        const {persistPath, instances} = await selected();
        const names = [];
        for (const instance of instances) {
          const readMetadata = dependencies?.readFastWarmLanMetadata
            ?? require('../dist/device/lan/FastWarmLanBootstrap').readFastWarmLanMetadata;
          const metadata = await readMetadata(persistPath, instance.instanceId).catch(() => []);
          for (const device of instance.devices) {
            const configured = instance.names.find(item => item.deviceId === device.deviceId);
            const cached = metadata.find(item => item.id === device.deviceId);
            const name = configured?.name ?? cached?.name;
            const roomName = configured?.roomName ?? cached?.room_name;
            names.push({instanceId: instance.instanceId, deviceId: device.deviceId,
              ...(typeof name === 'string' && name.length <= 256 ? {name} : {}),
              ...(typeof roomName === 'string' && roomName.length <= 256 ? {roomName} : {}),
            });
          }
        }
        return {names};
      } catch {
        throw unavailable();
      }
    },
    '/local/refresh': async payload => {
      try {
        if (!record(payload) || Reflect.ownKeys(payload).join(',') !== 'instanceId'
          || typeof payload.instanceId !== 'string' || !/^[a-f0-9]{16}$/.test(payload.instanceId)) {
          throw unavailable();
        }
        const {persistPath, instances} = await selected();
        const matches = instances.filter(instance => instance.instanceId === payload.instanceId);
        if (matches.length !== 1 || !matches[0].options || matches[0].options.projectType !== '2') {
          throw unavailable();
        }
        const deviceIds = matches[0].devices.filter(device => device.enabled).map(device => device.deviceId);
        if (!deviceIds.length) {
          throw unavailable();
        }
        // This is the sole explicit cloud action. Listing and key storage never load or call it.
        const refresh = dependencies?.refreshFastWarmCloudMetadata
          ?? require('../dist/cloud/FastWarmCloudMetadataRefresh').refreshFastWarmCloudMetadata;
        const result = await refresh({persistPath, instanceId: payload.instanceId, options: matches[0].options, deviceIds});
        if (!record(result) || result.refreshed !== true || result.restartRequired !== true || result.deviceCount !== deviceIds.length) {
          throw unavailable();
        }
        return {refreshed: true, restartRequired: true, deviceCount: deviceIds.length};
      } catch {
        throw unavailable();
      }
    },
    '/local/key': async payload => {
      try {
        if (!record(payload) || Reflect.ownKeys(payload).sort().join(',') !== 'deviceId,instanceId,localKey'
          || typeof payload.instanceId !== 'string' || !/^[a-f0-9]{16}$/.test(payload.instanceId)
          || typeof payload.deviceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.deviceId)
          || typeof payload.localKey !== 'string' || !/^[\x20-\x7e]{16}$/.test(payload.localKey)) {
          throw unavailable();
        }
        const {persistPath, devices} = await selected();
        const matches = devices.filter(device => device.instanceId === payload.instanceId && device.deviceId === payload.deviceId);
        if (matches.length !== 1) {
          throw unavailable();
        }
        await new (helpers().FastWarmLanKeyStore)(persistPath, payload.instanceId).set(payload.deviceId, payload.localKey);
        return {stored: true, restartRequired: true};
      } catch {
        throw unavailable();
      }
    },
  };
}

async function start() {
  const {HomebridgePluginUiServer, RequestError} = await import('@homebridge/plugin-ui-utils');
  class FastWarmSetupUiServer extends HomebridgePluginUiServer {
    constructor() {
      super();
      const handlers = createLocalSetupHandlers({storagePath: this.homebridgeStoragePath, configPath: this.homebridgeConfigPath});
      for (const [route, handler] of Object.entries(handlers)) {
        this.onRequest(route, async payload => {
          try {
            return await handler(payload);
          } catch {
            throw new RequestError(ERROR_MESSAGE, {status: 400});
          }
        });
      }
      this.ready();
    }
  }
  new FastWarmSetupUiServer();
}

module.exports = {
  ERROR_MESSAGE, instanceIdForPlatform, configuredDevices, configuredInstances, readConfiguration, createLocalSetupHandlers,
};
if (require.main === module) {
  start().catch(() => {
    // eslint-disable-next-line no-console -- A fixed startup message contains no request or configuration data.
    console.error('The FastWarm setup page could not start.');
    process.exitCode = 1;
  });
}
