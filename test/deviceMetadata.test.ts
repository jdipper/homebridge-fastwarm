import fs from 'fs/promises';
import path from 'path';
import TuyaDevice, {TuyaDeviceSchemaMode as Mode, TuyaDeviceSchemaType as Type} from '../src/device/TuyaDevice';
import {deviceMetadata} from '../src/deviceMetadata';
import {saveFastWarmLanMetadata} from '../src/device/lan/FastWarmLanBootstrap';
import type {FastWarmDeviceConfig} from '../src/config';

const INSTANCE = '0123456789abcdef', roots: string[] = [];
const selection = (deviceId = 'selected'): FastWarmDeviceConfig => ({deviceId, address: '192.168.1.50', version: '3.5', model: 'ET-63'});
function cached(deviceId = 'selected'): TuyaDevice {
  return new TuyaDevice({id: deviceId, uuid: 'stable-uuid-' + deviceId, name: 'Cached device', category: 'wk',
    product_id: 'lmtejj3f4kafi2k1', product_name: 'ET-63', owner_id: 'metadata-owner', room_id: 'cached-room-id',
    room_name: 'Cached room', online: true, time_zone: '+00:00',
    schema: [{code: 'switch', mode: Mode.READ_WRITE, type: Type.Boolean, property: {}},
      {code: 'temp_set', mode: Mode.READ_WRITE, type: Type.Integer, property: {min: 50, max: 400, scale: 1, step: 5, unit: ''}}],
    status: [{code: 'switch', value: true}, {code: 'temp_set', value: 180}, {code: 'temp_unit_convert', value: 'c'}]});
}
async function fixture(devices?: TuyaDevice[]) {
  const root = await fs.mkdtemp('/private/tmp/fw-inventory-'); roots.push(root);
  const persist = path.join(root, 'persist'), file = path.join(persist, `FastWarmLocalMetadata.${INSTANCE}.json`);
  if (devices) {
    await saveFastWarmLanMetadata(persist, INSTANCE, devices);
  }
  return {root, persist, file};
}
afterEach(async () => {
  jest.restoreAllMocks();
  for (const root of roots.splice(0)) {
    await fs.rm(root, {recursive: true, force: true});
  }
});

test('private cached identity, schema and statuses survive offline restoration without rewriting metadata', async () => {
  const original = cached(), data = await fixture([original]), before = await fs.readFile(data.file);
  const result = await deviceMetadata(data.persist, INSTANCE, [selection()]);
  expect(result.saveNeeded).toBe(false);
  expect(result.devices).toHaveLength(1);
  expect(result.devices[0]).toBeInstanceOf(TuyaDevice);
  expect(result.devices[0]).toMatchObject({id: original.id, uuid: original.uuid, name: original.name, room_id: original.room_id,
    room_name: original.room_name, product_id: original.product_id, owner_id: original.owner_id,
    schema: original.schema, status: original.status, online: false});
  expect(await fs.readFile(data.file)).toEqual(before);
  expect(original.online).toBe(true);
});

test('selected labels override the runtime copy without changing UUID, cached bytes or native status', async () => {
  const original = cached(), data = await fixture([original]), before = await fs.readFile(data.file);
  const result = await deviceMetadata(data.persist, INSTANCE, [{...selection(), name: 'Explicit device', roomName: 'Explicit room'}]);
  expect(result.devices[0]).toMatchObject({uuid: original.uuid, name: 'Explicit device', room_name: 'Explicit room',
    room_id: original.room_id, status: original.status, schema: original.schema, online: false});
  expect(result.saveNeeded).toBe(false);
  expect(await fs.readFile(data.file)).toEqual(before);
});

test('a new enabled ET-63 has only the supported static schema and stays offline until the platform owns persistence', async () => {
  const data = await fixture();
  const result = await deviceMetadata(data.persist, INSTANCE, [{...selection(), name: 'New device', roomName: 'New room'}]);
  expect(result.saveNeeded).toBe(true);
  expect(result.devices[0]).toMatchObject({id: 'selected', uuid: 'selected', name: 'New device', room_name: 'New room', model: 'ET-63',
    product_id: 'lmtejj3f4kafi2k1', category: 'wk', online: false, status: []});
  expect(result.devices[0].schema.map(item => item.code).sort()).toEqual(['switch', 'temp_current', 'temp_set', 'temp_unit_convert']);
  expect(result.devices[0].schema.find(item => item.code === 'temp_set'))
    .toEqual({code: 'temp_set', mode: 'rw', type: 'Integer', property: {min: 41, max: 1040, scale: 1, step: 1, unit: ''}});
  expect(result.devices[0].schema.find(item => item.code === 'temp_current'))
    .toMatchObject({mode: 'ro', type: 'Integer', property: {scale: 1}});
  expect(await fs.readdir(data.root)).toEqual([]);
});

test('unselected cached inventory is retained, disabled selections are omitted, and only new enabled devices need saving', async () => {
  const data = await fixture([cached(), cached('disabled'), cached('unselected')]), before = await fs.readFile(data.file);
  const result = await deviceMetadata(data.persist, INSTANCE,
    [selection(), {...selection('disabled'), enabled: false}, selection('new-device')]);
  expect(result.devices.map(device => device.id)).toEqual(['selected', 'new-device']);
  expect(result.cache.map(device => device.id).sort()).toEqual(['disabled', 'new-device', 'selected', 'unselected']);
  expect(result.cache.every(device => device.online === false)).toBe(true);
  expect(result.saveNeeded).toBe(true);
  expect(await fs.readFile(data.file)).toEqual(before);
});

test('a missing metadata file is read without creating a file or replacing disabled inventory', async () => {
  const data = await fixture(); await fs.mkdir(data.persist, {mode: 0o700});
  const result = await deviceMetadata(data.persist, INSTANCE, [{...selection(), enabled: false}]);
  expect(result).toEqual({devices: [], saveNeeded: false, cache: []});
  expect(await fs.readdir(data.persist)).toEqual([]);
});

test.each(['malformed', 'wrong-product', 'unknown-cache-field'])(
  'a %s private cache is fatal and never replaced with new static metadata', async mutation => {
    const data = await fixture([cached()]);
    if (mutation === 'malformed') {
      await fs.writeFile(data.file, '{broken-json', {mode: 0o600});
    } else {
      const value = JSON.parse(await fs.readFile(data.file, 'utf8'));
      if (mutation === 'wrong-product') {
        value.devices[0].product_id = 'unverified-product';
      } else {
        value.devices[0].localKey = 'never-cache-private-key';
      }
      await fs.writeFile(data.file, JSON.stringify(value), {mode: 0o600});
    }
    const before = await fs.readFile(data.file);
    await expect(deviceMetadata(data.persist, INSTANCE, [selection(), selection('new-device')])).rejects.toThrow();
    expect(await fs.readFile(data.file)).toEqual(before);
    expect(await fs.readdir(data.persist)).toEqual([path.basename(data.file)]);
  });

test.each([0o644, 0o660])('a permissive cache (%s) is fatal without changing bytes or permissions', async mode => {
  const data = await fixture([cached()]), before = await fs.readFile(data.file); await fs.chmod(data.file, mode);
  await expect(deviceMetadata(data.persist, INSTANCE, [selection()])).rejects.toThrow();
  expect(await fs.readFile(data.file)).toEqual(before);
  expect((await fs.stat(data.file)).mode & 0o777).toBe(mode);
});

test('a symlink cache is fatal and neither the link nor its private target is overwritten', async () => {
  const data = await fixture([cached()]), target = path.join(data.root, 'original.json');
  await fs.rename(data.file, target);
  await fs.symlink(target, data.file);
  const before = await fs.readFile(target);
  await expect(deviceMetadata(data.persist, INSTANCE, [selection()])).rejects.toThrow();
  expect((await fs.lstat(data.file)).isSymbolicLink()).toBe(true);
  expect(await fs.readFile(target)).toEqual(before);
});
