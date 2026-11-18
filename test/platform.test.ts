/* eslint-disable @typescript-eslint/no-explicit-any */
import EventEmitter from 'events';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import https from 'https';
import {request} from 'http';
import {FastWarmPlatform, PLATFORM_NAME, PLUGIN_NAME} from '../src/platform';
import TuyaDevice from '../src/device/TuyaDevice';
import FastWarmLanController from '../src/device/lan/FastWarmLanController';
import {FastWarmLanKeyStore} from '../src/device/lan/FastWarmLanConfiguration';
import {saveFastWarmLanMetadata} from '../src/device/lan/FastWarmLanBootstrap';
import ThermostatAccessory from '../src/accessory/ThermostatAccessory';

jest.mock('../src/device/lan/FastWarmLanController', () => ({__esModule: true, default: jest.fn()}));
jest.mock('../src/accessory/ThermostatAccessory', () => ({__esModule: true, default: jest.fn()}));
const INSTANCE = '0123456789abcdef', ID = 'fixture-thermostat';
const fixtures: {root: string; platform: FastWarmPlatform}[] = [];
const log = {info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn()};

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(async () => {
  for (const value of fixtures.splice(0)) {
    await value.platform.close(); await fs.rm(value.root, {recursive: true, force: true});
  }
  jest.restoreAllMocks();
});

function existing(): TuyaDevice {
  return new TuyaDevice({id: ID, uuid: 'retained-private-uuid', name: 'Retained thermostat', room_name: 'Fixture room',
    product_id: 'lmtejj3f4kafi2k1', category: 'wk', owner_id: 'fixture-owner', online: true,
    schema: [{code: 'temp_set', mode: 'rw', type: 'Integer', property: {min: 50, max: 400, step: 5, scale: 1, unit: 'C'}}] as any,
    status: [{code: 'temp_current', value: 999}, {code: 'temp_set', value: 999}, {code: 'temp_unit_convert', value: 'c'}]});
}

async function fixture(options: {cache?: boolean; malformed?: boolean; missingKey?: boolean; waitForLAN?: Promise<void>} = {}) {
  // Keep Unix socket paths below Darwin's shorter path limit.
  const temporary = process.platform === 'darwin' ? '/tmp' : os.tmpdir();
  const root = await fs.realpath(await fs.mkdtemp(path.join(temporary, 'fwp-'))), persist = path.join(root, 'persist');
  await fs.mkdir(persist, {mode: 0o700});
  const metadata = path.join(persist, `FastWarmLocalMetadata.${INSTANCE}.json`);
  const keyFile = path.join(persist, `FastWarmLocalKeys.${INSTANCE}.json`);
  if (options.cache !== false) {
    await saveFastWarmLanMetadata(persist, INSTANCE, [existing()]);
  }
  if (options.malformed) {
    await fs.writeFile(metadata, '{invalid-json', {mode: 0o600});
  }
  if (!options.missingKey) {
    await new FastWarmLanKeyStore(persist, INSTANCE).set(ID, 'abcdefghijklmnop');
  }
  const cloud = jest.spyOn(https, 'request').mockImplementation(() => {
    throw Error('Unexpected cloud request');
  });
  const raw = new Set<any>(), connections = new Set<any>(), connected = new Set<string>();
  const handlers: any[] = [], beforeOnline: boolean[][] = [];
  const descriptor = path.join(persist, `TuyaProgrammeProvider.${INSTANCE}.json`);
  const owner = path.join(persist, `TuyaProgrammeProviderOwner.${INSTANCE}.json`);
  let controller: any, seededAtLAN: Buffer | undefined;
  const emit = (value = 195) => {
    for (const listener of raw) {
      listener('fixture/lan', 4, {devId: ID, source: 'lan', status: [
        {code: 'RoomTemper', dp_id: 105, value}, {code: 'SetTemp', dp_id: 102, value: 180},
        {code: 'TemperUnitChange', dp_id: 107, value: false}, {code: 'ControlMode', dp_id: 103, value: 'smart'},
        {code: 'Event_Adaptive_Set', dp_id: 110, value: 0}, {code: 'power1', dp_id: 101, value: true},
      ]}, Date.now());
    }
  };
  jest.mocked(FastWarmLanController).mockImplementation((devices, keys) => {
    controller = {has: (id: string) => devices.some(device => device.deviceId === id),
      isConnected: (id: string) => connected.has(id), generation: () => 1,
      addRawMessageListener: (listener: any) => raw.add(listener), removeRawMessageListener: (listener: any) => raw.delete(listener),
      addConnectionListener: (listener: any) => connections.add(listener),
      removeConnectionListener: (listener: any) => connections.delete(listener),
      start: jest.fn(async (inventory: TuyaDevice[]) => {
        beforeOnline.push(inventory.map(device => device.online));
        // The first hardware action must follow the exclusive claim and authenticated IPC startup.
        expect(JSON.parse(await fs.readFile(owner, 'utf8')).pid).toBe(process.pid);
        expect(JSON.parse(await fs.readFile(descriptor, 'utf8')).plugin).toBe(PLUGIN_NAME);
        seededAtLAN = await fs.readFile(metadata);
        if (options.waitForLAN) {
          await options.waitForLAN;
        }
        for (const device of inventory) {
          if (keys.has(device.id)) {
            connected.add(device.id); for (const listener of connections) {
              listener({deviceId: device.id, connected: true, generation: 1});
            } emit();
          }
        }
      }),
      close: jest.fn(() => {
        connected.clear();
      }), readProperties: jest.fn(), readSchedule: jest.fn(), issueOnce: jest.fn(),
    }; return controller;
  });
  jest.mocked(ThermostatAccessory).mockImplementation((platform, accessory) => {
    const handler: any = {device: platform.deviceManager!.getDevice(accessory.context.deviceID), checkRequirements: jest.fn(() => true),
      configureServices: jest.fn(), configureStatusActive: jest.fn(), updateAllValues: jest.fn(), onDeviceStatusUpdate: jest.fn(),
      onDeviceInfoUpdate: jest.fn(), intialized: false}; handlers.push(handler); return handler;
  });
  const events = new EventEmitter(), createAccessory = jest.fn((name, UUID) => ({displayName: name, UUID, context: {}}));
  const api: any = Object.assign(events, {hap: {Service: {}, Characteristic: {}, uuid: {generate: (id: string) => 'uuid:' + id}},
    user: {persistPath: () => persist}, platformAccessory: createAccessory, registerPlatformAccessories: jest.fn(),
    updatePlatformAccessories: jest.fn(), unregisterPlatformAccessories: jest.fn()});
  const config: any = {platform: PLATFORM_NAME, name: 'Fixture bridge', instanceId: INSTANCE,
    devices: [{deviceId: ID, address: '192.168.1.10', version: '3.5', model: 'ET-63'}]};
  const platform = new FastWarmPlatform(log as any, config, api); fixtures.push({root, platform});
  return {root, persist, platform, api, config, events, metadata, keyFile, descriptor, owner, cloud, handlers,
    createAccessory, controller: () => controller, beforeOnline, seededAtLAN: () => seededAtLAN, emit};
}

function ipc(socketPath: string, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = request({socketPath, path: '/provider/list', method: 'POST', headers: {Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json', 'Content-Length': 2}}, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (error) {
          reject(error);
        }
      });
      response.on('error', reject);
    }); req.on('error', reject); req.end('{}');
  });
}

test('cold startup owns IPC before LAN, reuses the same cached accessory and preserves legacy private identity', async () => {
  const f = await fixture(), beforeKeys = await fs.readFile(f.keyFile), beforeMetadata = await fs.readFile(f.metadata);
  const cached: any = {UUID: 'uuid:' + ID, displayName: 'Cached thermostat', context: {deviceID: ID}};
  const unknown: any = {UUID: 'unrelated', context: {}};
  f.platform.configureAccessory(cached); f.platform.configureAccessory(unknown); await f.platform.start();
  expect(f.beforeOnline).toEqual([[false]]); expect(f.platform.deviceManager!.devices[0].uuid).toBe('retained-private-uuid');
  expect(f.api.updatePlatformAccessories).toHaveBeenCalledWith([cached]); expect(f.api.registerPlatformAccessories).not.toHaveBeenCalled();
  expect(f.createAccessory).not.toHaveBeenCalled(); expect(f.api.unregisterPlatformAccessories).not.toHaveBeenCalled();
  expect(f.handlers[0].intialized).toBe(true); expect(f.handlers[0].device.id).toBe(ID);
  expect(await fs.readFile(f.keyFile)).toEqual(beforeKeys); expect(await fs.readFile(f.metadata)).toEqual(beforeMetadata);
  const descriptor = JSON.parse(await fs.readFile(f.descriptor, 'utf8')), response = await ipc(descriptor.socketPath, descriptor.token);
  expect(response.instanceId).toBe(INSTANCE); expect(response.zones).toHaveLength(1);
  expect(response.zones[0]).toMatchObject({id: ID, online: true, temperatureSource: 'lan', measuredC: 19.5});
  expect(f.cloud).not.toHaveBeenCalled();
  expect(Object.keys(require.cache).some(file => /homebridge-fastwarm\/src\/cloud\//.test(file))).toBe(false);
  expect(Object.keys(require.cache).some(file => /node_modules\/mqtt\//.test(file))).toBe(false);
});

test('concurrent start calls share one provider claim and one LAN startup', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const f = await fixture({waitForLAN: gate}), first = f.platform.start(), second = f.platform.start();
  try {
    expect(second).toBe(first); const deadline = Date.now() + 1000;
    while (!f.controller()?.start.mock.calls.length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    expect(f.controller().start).toHaveBeenCalledTimes(1); expect(FastWarmLanController).toHaveBeenCalledTimes(1);
  } finally {
    release(); await Promise.allSettled([first, second]);
  }
  expect(f.handlers).toHaveLength(1); expect(f.cloud).not.toHaveBeenCalled();
});

test('Homebridge launch starts the native provider once and repeated launch does not create another owner', async () => {
  const f = await fixture(); expect(f.events.listenerCount('didFinishLaunching')).toBe(1);
  f.events.emit('didFinishLaunching'); await f.platform.start();
  f.events.emit('didFinishLaunching'); await f.platform.start();
  expect(f.controller().start).toHaveBeenCalledTimes(1); expect(f.platform.programmeProvider).toBeDefined();
  expect(f.cloud).not.toHaveBeenCalled();
});

test.each([true, false])('a live legacy owner prevents all thermostat startup and metadata changes (existing cache=%s)', async cache => {
  const f = await fixture({cache}), before = cache ? await fs.readFile(f.metadata) : undefined;
  const original = JSON.stringify({pid: process.pid, token: 'a'.repeat(64)}); await fs.writeFile(f.owner, original, {mode: 0o600});
  await expect(f.platform.start()).rejects.toThrow('already running'); expect(f.controller().start).not.toHaveBeenCalled();
  expect(await fs.readFile(f.owner, 'utf8')).toBe(original); expect(f.api.registerPlatformAccessories).not.toHaveBeenCalled();
  if (cache) {
    expect(await fs.readFile(f.metadata)).toEqual(before);
  } else {
    await expect(fs.stat(f.metadata)).rejects.toMatchObject({code: 'ENOENT'});
  }
  expect(f.cloud).not.toHaveBeenCalled();
});

test('a new explicit ET-63 profile is seeded privately only after ownership and stays unavailable until native status', async () => {
  const f = await fixture({cache: false}); await expect(fs.stat(f.metadata)).rejects.toMatchObject({code: 'ENOENT'});
  await f.platform.start(); expect(f.beforeOnline).toEqual([[false]]); expect(f.seededAtLAN()).toBeDefined();
  expect((await fs.stat(f.metadata)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(f.seededAtLAN()!.toString()).devices[0]).toMatchObject({id: ID, uuid: ID, product_id: 'lmtejj3f4kafi2k1', status: []});
  expect(f.api.registerPlatformAccessories).toHaveBeenCalledWith(PLUGIN_NAME, PLATFORM_NAME,
    [expect.objectContaining({UUID: 'uuid:' + ID})]);
  expect(f.cloud).not.toHaveBeenCalled();
});

test('bad cached metadata cannot be replaced by a new static seed', async () => {
  const f = await fixture({malformed: true}), before = await fs.readFile(f.metadata);
  await expect(f.platform.start()).rejects.toThrow(); expect(FastWarmLanController).not.toHaveBeenCalled();
  expect(await fs.readFile(f.metadata)).toEqual(before); expect(f.cloud).not.toHaveBeenCalled();
});

test('missing keys leave the thermostat offline without falling back to cached temperature or cloud', async () => {
  const f = await fixture({missingKey: true}); await f.platform.start();
  expect(f.platform.deviceManager!.devices[0].online).toBe(false); expect(f.platform.deviceManager!.isTemperatureAvailable(ID)).toBe(false);
  const response = await f.platform.programmeProvider!.handle('/provider/list', {}) as any;
  expect(response.zones[0]).toMatchObject({id: ID, online: false, measuredC: null, targetC: null}); expect(f.cloud).not.toHaveBeenCalled();
});

test('post-start native updates reach only the matching accessory binding', async () => {
  const f = await fixture(); await f.platform.start(); f.emit(200);
  expect(f.handlers[0].onDeviceStatusUpdate).toHaveBeenCalledWith(expect.arrayContaining([{code: 'temp_current', value: 200}]));
});

test('shutdown before launch never acquires IPC or starts a thermostat connection', async () => {
  const f = await fixture(); f.events.emit('shutdown'); await f.platform.start();
  expect(FastWarmLanController).not.toHaveBeenCalled(); await expect(fs.stat(f.owner)).rejects.toMatchObject({code: 'ENOENT'});
});
