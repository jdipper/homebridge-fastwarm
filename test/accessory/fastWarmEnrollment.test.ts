/* eslint-disable @typescript-eslint/no-explicit-any */
import EventEmitter from 'events';
import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import * as hap from '@homebridge/hap-nodejs';
import {FastWarmPlatform} from '../../src/platform';
import FastWarmLanController from '../../src/device/lan/FastWarmLanController';
import {FastWarmLanKeyStore} from '../../src/device/lan/FastWarmLanConfiguration';

jest.mock('../../src/device/lan/FastWarmLanController', () => ({__esModule: true, default: jest.fn()}));

class PlatformAccessory extends hap.Accessory {context: Record<string, unknown> = {};}

test('real HAP handlers publish healthy and key-pending ET-63 devices without stopping the healthy provider', async () => {
  const root = await fs.mkdtemp('/private/tmp/fw-hap-'), persist = path.join(root, 'persist');
  const instanceId = '0123456789abcdef';
  await fs.mkdir(persist, {mode: 0o700});
  await new FastWarmLanKeyStore(persist, instanceId).set('healthy', 'abcdefghijklmnop');
  const online = new Set<string>(), raw = new Set<any>(), connections = new Set<any>();
  const cloud = jest.spyOn(https, 'request').mockImplementation(() => {throw Error('Unexpected cloud access');});
  let controller: any;
  jest.mocked(FastWarmLanController).mockImplementation((selections, keys) => {
    controller = {has: (id: string) => selections.some(item => item.deviceId === id), isConnected: (id: string) => online.has(id),
      generation: () => 1, addRawMessageListener: (listener: any) => raw.add(listener),
      removeRawMessageListener: (listener: any) => raw.delete(listener), addConnectionListener: (listener: any) => connections.add(listener),
      removeConnectionListener: (listener: any) => connections.delete(listener),
      start: jest.fn(async () => {
        expect(keys.has('healthy')).toBe(true); expect(keys.has('pending')).toBe(false);
        online.add('healthy');
        for (const listener of connections) listener({deviceId: 'healthy', connected: true, generation: 1});
        for (const listener of raw) listener('fixture/lan', 4, {devId: 'healthy', source: 'lan', status: [
          {code: 'RoomTemper', dp_id: 105, value: 195}, {code: 'SetTemp', dp_id: 102, value: 180},
          {code: 'TemperUnitChange', dp_id: 107, value: false}, {code: 'power1', dp_id: 101, value: true},
          {code: 'ControlMode', dp_id: 103, value: 'smart'}, {code: 'Event_Adaptive_Set', dp_id: 110, value: 0},
        ]}, Date.now());
      }), close: jest.fn(() => online.clear()), issueOnce: jest.fn(), readProperties: jest.fn(), readSchedule: jest.fn(),
    };
    return controller;
  });
  const registered: PlatformAccessory[] = [];
  const api: any = Object.assign(new EventEmitter(), {hap, user: {persistPath: () => persist}, platformAccessory: PlatformAccessory,
    registerPlatformAccessories: (_plugin: string, _alias: string, accessories: PlatformAccessory[]) => registered.push(...accessories),
    updatePlatformAccessories: jest.fn(), unregisterPlatformAccessories: jest.fn()});
  const log = {info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn()};
  const platform = new FastWarmPlatform(log as any, {platform: 'FastWarmPlatform', instanceId,
    devices: [{deviceId: 'healthy', address: '192.168.1.50', version: '3.5'},
      {deviceId: 'pending', address: '192.168.1.51', version: '3.5'}]} as any, api);
  try {
    await platform.start();
    expect(registered).toHaveLength(2); expect(platform.programmeProvider).toBeDefined();
    expect(controller.close).not.toHaveBeenCalled(); expect(cloud).not.toHaveBeenCalled();
    const healthy = registered.find(accessory => accessory.context.deviceID === 'healthy')!.getService(hap.Service.Thermostat)!;
    const pending = registered.find(accessory => accessory.context.deviceID === 'pending')!.getService(hap.Service.Thermostat)!;
    expect(await (healthy.getCharacteristic(hap.Characteristic.CurrentTemperature) as any).getHandler()).toBe(19.5);
    expect(await (healthy.getCharacteristic(hap.Characteristic.TargetTemperature) as any).getHandler()).toBe(18);
    expect(pending.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).props.validValues)
      .toEqual([hap.Characteristic.TargetHeatingCoolingState.AUTO, hap.Characteristic.TargetHeatingCoolingState.OFF]);
    for (const type of [hap.Characteristic.CurrentTemperature, hap.Characteristic.TargetTemperature,
      hap.Characteristic.TargetHeatingCoolingState, hap.Characteristic.CurrentHeatingCoolingState, hap.Characteristic.TemperatureDisplayUnits]) {
      await expect(Promise.resolve().then(() => (pending.getCharacteristic(type) as any).getHandler()))
        .rejects.toMatchObject({hapStatus: hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE});
    }
    await expect((pending.getCharacteristic(hap.Characteristic.TargetTemperature) as any).setHandler(20))
      .rejects.toMatchObject({hapStatus: hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE});
    expect(platform.deviceManager!.getDevice('pending')!.status).toEqual([]);
    expect(controller.issueOnce).not.toHaveBeenCalled();
  } finally {
    await platform.close(); jest.restoreAllMocks(); await fs.rm(root, {recursive: true, force: true});
  }
});
