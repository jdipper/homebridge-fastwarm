import {newInstanceId, parseFastWarmConfiguration} from '../src/config';

const ERROR = 'FastWarm setup needs a stable instance ID and enabled ET-63 devices with private IPv4 addresses and protocol 3.5.';
const selection = {deviceId: 'fixture-thermostat', address: '192.168.1.50', version: '3.5'};
const fixture = () => ({platform: 'FastWarmPlatform', name: 'Fixture platform', instanceId: '0123456789abcdef', devices: [{...selection}]});

test('an explicit stable instance and native ET-63 selections need no SmartLife or account configuration', () => {
  const source = fixture(), parsed = parseFastWarmConfiguration(source);
  expect(parsed).toMatchObject({platform: 'FastWarmPlatform', instanceId: '0123456789abcdef', devices: [{...selection, model: 'ET-63'}]});
  expect(parsed).not.toHaveProperty('smartLife');
  expect(parsed.devices[0]).not.toBe(source.devices[0]);
  expect(source.devices[0]).not.toHaveProperty('model');
  expect(parseFastWarmConfiguration({...source, _bridge: {username: 'AA:BB:CC:DD:EE:FF'}}).instanceId).toBe(parsed.instanceId);
});

test('explicit labels are trimmed without changing native selection or platform identity', () => {
  const parsed = parseFastWarmConfiguration({...fixture(), devices: [{...selection, name: ' Device name ', roomName: ' Room name '}]});
  expect(parsed.devices).toEqual([{...selection, model: 'ET-63', name: 'Device name', roomName: 'Room name'}]);
  expect(parsed.instanceId).toBe(fixture().instanceId);
});

test('instance generation produces independent lowercase 16-hex IDs but parsing never invents one', () => {
  const first = newInstanceId(), second = newInstanceId();
  expect(first).toMatch(/^[a-f0-9]{16}$/);
  expect(second).toMatch(/^[a-f0-9]{16}$/);
  expect(first).not.toBe(second);
  expect(() => parseFastWarmConfiguration({platform: 'FastWarmPlatform', devices: [selection]})).toThrow(ERROR);
});

test.each(['', 'ABCDEF0123456789', '0123456789abcde', '0123456789abcdef0', '../outside', null, 123])(
  'rejects invalid explicit instance ID %j', instanceId => {
    expect(() => parseFastWarmConfiguration({...fixture(), instanceId})).toThrow(ERROR);
  });

test.each([
  null, [], 'config', {}, {...fixture(), platform: 'TuyaPlatform'}, {...fixture(), debug: 'true'},
  {...fixture(), devices: []}, {...fixture(), devices: [{...selection, enabled: false}]},
  {...fixture(), devices: [{...selection, model: 'other-model'}]},
  {...fixture(), devices: [{...selection, version: '3.3'}]},
  {...fixture(), devices: [{...selection, address: '8.8.8.8'}]},
  {...fixture(), devices: [{...selection, localKey: 'never-print-inline-key'}]},
  {...fixture(), devices: [{...selection, local_key: 'never-print-inline-key'}]},
  {...fixture(), devices: [{...selection, unknown: true}]},
  {...fixture(), options: {username: 'never-print-user', password: 'never-print-password'}},
  {...fixture(), account: {accessKey: 'never-print-account-key'}},
  {...fixture(), username: 'never-print-user'}, {...fixture(), password: 'never-print-password'},
  {...fixture(), accessId: 'never-print-access-id'}, {...fixture(), accessKey: 'never-print-access-key'},
  {...fixture(), extra: true}, {...fixture(), smartLife: 'not-an-object'},
])('rejects malformed, unsupported or account-bearing top-level setup %#', value => {
  expect(() => parseFastWarmConfiguration(value)).toThrow(ERROR);
  try {
    parseFastWarmConfiguration(value);
  } catch (error) {
    expect(String(error)).not.toContain('never-print');
  }
});

test('duplicate device IDs and addresses are rejected even when one selection is disabled', () => {
  for (const duplicate of [{...selection, address: '192.168.1.51', enabled: false},
    {...selection, deviceId: 'second-device', enabled: false}]) {
    expect(() => parseFastWarmConfiguration({...fixture(), devices: [selection, duplicate]})).toThrow(ERROR);
  }
});

test.each(['', ' ', '\0', 'a'.repeat(257)])('rejects invalid local labels %j', label => {
  for (const field of ['name', 'roomName']) {
    expect(() => parseFastWarmConfiguration({...fixture(), devices: [{...selection, [field]: label}]})).toThrow(ERROR);
  }
});

test('plain optional SmartLife data is retained for an explicit import without becoming a runtime requirement', () => {
  const optional = {projectType: '2', accessId: 'fixture-access', accessKey: 'fixture-key', countryCode: 44,
    username: 'fixture-user', password: 'fixture-password', appSchema: 'smartlife'};
  const source = {...fixture(), smartLife: optional}, parsed = parseFastWarmConfiguration(source);
  expect(parsed.smartLife).toEqual(optional);
  expect(parsed.instanceId).toBe(source.instanceId);
  expect(parsed.devices).toEqual(parseFastWarmConfiguration(fixture()).devices);
});

test('getters, custom prototypes and symbol fields are rejected before reading or logging values', () => {
  const getter = jest.fn(() => {
    throw Error('never-print-getter-secret');
  });
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const rootGetter = Object.defineProperty(fixture(), 'instanceId', {get: getter, enumerable: true});
    const deviceGetter = Object.defineProperty({...selection}, 'deviceId', {get: getter, enumerable: true});
    const accountGetter = Object.defineProperty({}, 'password', {get: getter, enumerable: true});
    for (const value of [rootGetter, {...fixture(), devices: [deviceGetter]}, {...fixture(), smartLife: accountGetter},
      Object.assign(Object.create({password: 'never-print-prototype-secret'}), fixture()),
      {...fixture(), devices: [Object.assign(Object.create({localKey: 'never-print-prototype-secret'}), selection)]},
      {...fixture(), [Symbol('secret')]: 'never-print-symbol'}, {...fixture(), devices: [{...selection, [Symbol('secret')]: true}]}]) {
      expect(() => parseFastWarmConfiguration(value)).toThrow(ERROR);
    }
    expect(getter).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  } finally {
    errorLog.mockRestore();
  }
});

test('hidden data fields are rejected rather than silently dropping account data or inline keys', () => {
  const root = Object.defineProperty(fixture(), 'password', {value: 'never-print-hidden-secret', enumerable: false});
  const hiddenKey = Object.defineProperty({...selection}, 'localKey', {value: 'never-print-hidden-secret', enumerable: false});
  const hiddenId = Object.defineProperty({...selection}, 'deviceId', {value: selection.deviceId, enumerable: false});
  for (const value of [root, {...fixture(), devices: [hiddenKey]}, {...fixture(), devices: [hiddenId]}]) {
    expect(() => parseFastWarmConfiguration(value)).toThrow(ERROR);
  }
});
