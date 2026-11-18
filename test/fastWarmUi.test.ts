import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import vm from 'vm';
import {execFileSync} from 'child_process';
import * as helpers from '../src/device/lan/FastWarmLanConfiguration';
import {createLocalSetupHandlers, instanceIdForPlatform, readConfiguration, ERROR_MESSAGE} from '../homebridge-ui/server';

const KEY = 'SECRET_KEY_12345';
const INSTANCE = '0123456789abcdef';
const local = {deviceId: 'fixture-device', address: '192.168.1.50', version: '3.5'};
const platform = () => ({platform: 'FastWarmPlatform', name: 'FastWarm', instanceId: INSTANCE,
  _bridge: {username: 'AA:BB:CC:DD:EE:01'}, devices: [{...local}], smartLife: {
    projectType: '2', endpoint: 'https://endpoint.invalid', accessId: 'ACCESS_ID_CANARY', accessKey: KEY,
    username: 'ACCOUNT_CANARY', password: 'PASSWORD_CANARY', countryCode: 44, appSchema: 'smartlife',
  },
});

describe('private standalone FastWarm setup routes', () => {
  let directory: string;
  let configPath: string;
  let handlers: ReturnType<typeof createLocalSetupHandlers>;
  let refreshMetadata: jest.Mock;
  let readMetadata: jest.Mock;
  beforeEach(async () => {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fastwarm-ui-')));
    configPath = path.join(directory, 'config.json');
    await fs.mkdir(path.join(directory, 'persist'), {mode: 0o700});
    refreshMetadata = jest.fn(async () => ({refreshed: true, restartRequired: true, deviceCount: 1}));
    readMetadata = jest.fn(async () => [{id: local.deviceId, name: 'Thermostat', room_name: 'Fixture Room'}]);
    handlers = createLocalSetupHandlers({storagePath: directory, configPath}, {...helpers,
      refreshFastWarmCloudMetadata: refreshMetadata, readFastWarmLanMetadata: readMetadata,
    });
    await fs.writeFile(configPath, JSON.stringify({platforms: [platform()]}), {mode: 0o600});
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, {recursive: true, force: true});
  });
  function payload() {return {instanceId: INSTANCE, deviceId: local.deviceId, localKey: KEY};}
  function noSecrets(value: unknown) {
    for (const secret of [KEY, 'ACCOUNT_CANARY', 'ACCESS_ID_CANARY', 'PASSWORD_CANARY', directory, 'AA:BB:CC:DD:EE:01']) {
      expect(JSON.stringify(value)).not.toContain(secret);
    }
  }
  test('explicit instance IDs retain the private namespace when bridge metadata or account details change', () => {
    const selected = platform();
    expect(instanceIdForPlatform(selected)).toBe(INSTANCE);
    expect(instanceIdForPlatform({...selected, _bridge: undefined, smartLife: undefined})).toBe(INSTANCE);
    expect(() => instanceIdForPlatform({...selected, instanceId: '../outside'})).toThrow(ERROR_MESSAGE);
  });
  test('listing devices and names uses only owned configuration, private keys and saved metadata', async () => {
    const devices = await handlers['/local/devices']({});
    expect(devices).toEqual({devices: [{instanceId: INSTANCE, ...local, enabled: true, keyStored: false}]});
    expect(await handlers['/local/instances']()).toEqual({instances: [{instanceId: INSTANCE,
      localOnly: true, cloudRefreshAvailable: true, deviceCount: 1}]});
    const labels = await handlers['/local/names']();
    expect(labels).toEqual({names: [{instanceId: INSTANCE, deviceId: local.deviceId, name: 'Thermostat', roomName: 'Fixture Room'}]});
    expect(refreshMetadata).not.toHaveBeenCalled();
    noSecrets(devices); noSecrets(labels);
  });
  test('local setup needs no SmartLife credentials and reports import unavailable', async () => {
    const selected = {...platform(), smartLife: undefined};
    await fs.writeFile(configPath, JSON.stringify({platforms: [selected]}));
    expect(await handlers['/local/instances']()).toEqual({instances: [{instanceId: INSTANCE,
      localOnly: true, cloudRefreshAvailable: false, deviceCount: 1}]});
    await handlers['/local/key'](payload());
    await expect(handlers['/local/refresh']({instanceId: INSTANCE})).rejects.toThrow(ERROR_MESSAGE);
    expect(refreshMetadata).not.toHaveBeenCalled();
    noSecrets(await handlers['/local/devices']());
  });
  test('incomplete optional SmartLife settings never block local setup or key import', async () => {
    await fs.writeFile(configPath, JSON.stringify({platforms: [{...platform(), smartLife: {}}]}));
    expect((await handlers['/local/devices']()).devices).toHaveLength(1);
    await handlers['/local/key'](payload());
    await expect(handlers['/local/refresh']({instanceId: INSTANCE})).rejects.toThrow(ERROR_MESSAGE);
    expect(refreshMetadata).not.toHaveBeenCalled();
    noSecrets(await handlers['/local/devices']());
  });
  test('configured labels take precedence, and unavailable metadata cannot erase them', async () => {
    const selected = {...platform(), devices: [{...local, name: 'ET63', roomName: 'Configured Room', model: 'ET-63'}]};
    await fs.writeFile(configPath, JSON.stringify({platforms: [selected]}));
    readMetadata.mockRejectedValueOnce(Error(KEY));
    expect(await handlers['/local/names']()).toEqual({names: [{instanceId: INSTANCE, deviceId: local.deviceId,
      name: 'ET63', roomName: 'Configured Room'}]});
    expect(refreshMetadata).not.toHaveBeenCalled();
  });
  test('six configured devices report only stored-key flags and retain exact instance/device identity', async () => {
    const selected = {...platform(), devices: Array.from({length: 6}, (_, n) => ({...local,
      deviceId: 'fixture-' + n, address: '192.168.1.' + (50 + n), enabled: true}))};
    await fs.writeFile(configPath, JSON.stringify({platforms: [selected]}));
    const store = new helpers.FastWarmLanKeyStore(path.join(directory, 'persist'), INSTANCE);
    for (const device of selected.devices) await store.set(device.deviceId, KEY);
    const result = await handlers['/local/devices']();
    expect(result.devices).toEqual(selected.devices.map(device => ({instanceId: INSTANCE, ...device, keyStored: true})));
    noSecrets(result);
    expect(refreshMetadata).not.toHaveBeenCalled();
  });
  test('key replacement is private and never imports metadata or restarts a bridge', async () => {
    expect(await handlers['/local/key'](payload())).toEqual({stored: true, restartRequired: true});
    const store = new helpers.FastWarmLanKeyStore(path.join(directory, 'persist'), INSTANCE);
    expect(await store.read(local.deviceId)).toBe(KEY);
    noSecrets(await handlers['/local/devices']());
    expect(refreshMetadata).not.toHaveBeenCalled();
  });
  test('the explicit import uses only the configured instance, credentials and enabled allowlist', async () => {
    const selected = {...platform(), devices: [local, {...local, deviceId: 'disabled', address: '10.0.0.5', enabled: false}]};
    await fs.writeFile(configPath, JSON.stringify({platforms: [selected]}));
    refreshMetadata.mockResolvedValue({refreshed: true, restartRequired: true, deviceCount: 1, secret: KEY});
    const result = await handlers['/local/refresh']({instanceId: INSTANCE});
    expect(result).toEqual({refreshed: true, restartRequired: true, deviceCount: 1});
    expect(refreshMetadata).toHaveBeenCalledWith({persistPath: path.join(directory, 'persist'), instanceId: INSTANCE,
      options: selected.smartLife, deviceIds: [local.deviceId]});
    expect(refreshMetadata).toHaveBeenCalledTimes(1); noSecrets(result);
  });
  test('separate instances keep key stores and cloud import selections isolated', async () => {
    const second = {...platform(), instanceId: 'fedcba9876543210', devices: [{...local, address: '10.0.0.2'}]};
    const unrelated = {...platform(), platform: 'TuyaPlatform'};
    await fs.writeFile(configPath, JSON.stringify({platforms: [unrelated, platform(), second]}));
    await handlers['/local/key']({...payload(), instanceId: second.instanceId});
    const result = await handlers['/local/devices']();
    expect(result.devices.map(device => device.keyStored)).toEqual([false, true]);
    await handlers['/local/refresh']({instanceId: second.instanceId});
    expect(refreshMetadata.mock.calls[0][0].instanceId).toBe(second.instanceId);
    noSecrets(result);
  });
  test.each([{instanceId: 'f'.repeat(16)}, {deviceId: '../outside'}, {deviceId: 'unknown'},
    {localKey: 'short'}, {localKey: 'é'.repeat(16)}, {localKey: KEY + '\n'}, {address: '10.0.0.99'}, {configPath: '/outside'}])
  ('rejects unconfigured identities, keys and browser-selected paths before storage', async override => {
    await expect(handlers['/local/key']({...payload(), ...override})).rejects.toThrow(ERROR_MESSAGE);
    expect(await fs.readdir(path.join(directory, 'persist'))).toEqual([]);
  });
  test('all route payloads reject untrusted selectors, prototypes and accessors', async () => {
    for (const route of ['/local/devices', '/local/instances', '/local/names']) {
      await expect(handlers[route]({instanceId: INSTANCE})).rejects.toThrow(ERROR_MESSAGE);
    }
    for (const value of [undefined, null, [], {}, {instanceId: '../outside'}, {instanceId: INSTANCE, options: platform().smartLife},
      {instanceId: INSTANCE, persistPath: directory}, Object.assign(Object.create({password: KEY}), {instanceId: INSTANCE}),
      Object.defineProperty({}, 'instanceId', {get: () => {throw Error(KEY);}})]) {
      await expect(handlers['/local/refresh'](value)).rejects.toThrow(ERROR_MESSAGE);
    }
    expect(refreshMetadata).not.toHaveBeenCalled();
  });
  test('ambiguous instances, inline keys and unknown device settings fail closed', async () => {
    for (const platforms of [[platform(), platform()], [{...platform(), devices: [{...local, localKey: KEY}]}],
      [{...platform(), devices: [{...local, model: 'UNSUPPORTED'}]}]]) {
      await fs.writeFile(configPath, JSON.stringify({platforms}));
      await expect(handlers['/local/devices']()).rejects.toThrow(ERROR_MESSAGE);
      await expect(handlers['/local/refresh']({instanceId: INSTANCE})).rejects.toThrow(ERROR_MESSAGE);
    }
    expect(refreshMetadata).not.toHaveBeenCalled();
  });
  test('import errors and malformed successes are sanitized without retrying', async () => {
    refreshMetadata.mockRejectedValueOnce(Error(KEY + directory));
    await expect(handlers['/local/refresh']({instanceId: INSTANCE})).rejects.toThrow(ERROR_MESSAGE);
    refreshMetadata.mockResolvedValueOnce({refreshed: true, restartRequired: true, deviceCount: 2});
    await expect(handlers['/local/refresh']({instanceId: INSTANCE})).rejects.toThrow(ERROR_MESSAGE);
    expect(refreshMetadata).toHaveBeenCalledTimes(2);
    expect(await fs.readdir(path.join(directory, 'persist'))).toEqual([]);
  });
  test('configuration symlinks, oversized files and writable files cannot bypass owned-file checks', async () => {
    const target = path.join(directory, 'actual.json');
    await fs.rename(configPath, target); await fs.symlink(target, configPath);
    await expect(readConfiguration(configPath)).rejects.toThrow(ERROR_MESSAGE);
    await fs.unlink(configPath);
    await fs.writeFile(configPath, 'x'.repeat(1024 * 1024 + 1), {mode: 0o600});
    await expect(readConfiguration(configPath)).rejects.toThrow(ERROR_MESSAGE);
    await fs.writeFile(configPath, JSON.stringify({platforms: []})); await fs.chmod(configPath, 0o666);
    await expect(readConfiguration(configPath)).rejects.toThrow(ERROR_MESSAGE);
  });
});

class Element {
  children: Element[] = []; listeners: Record<string, (event?: unknown) => unknown> = {};
  textContent = ''; value = ''; type = ''; disabled = false;
  attributes: Record<string, string> = {};
  constructor(readonly tag: string) {}
  appendChild(child: Element) {this.children.push(child); return child;}
  replaceChildren() {this.children = [];}
  setAttribute(name: string, value: string) {this.attributes[name] = value;}
  addEventListener(name: string, listener: (event?: unknown) => unknown) {this.listeners[name] = listener;}
  set innerHTML(_value: string) {throw Error('HTML interpolation is forbidden');}
}
function descendants(element: Element): Element[] {return [element, ...element.children.flatMap(descendants)];}

describe('standalone FastWarm setup page', () => {
  test.each([false, true])('loads local data, shows room names and hides stored keys; optional cloud import=%s', async cloud => {
    const html = await fs.readFile(path.join(__dirname, '../homebridge-ui/public/index.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    const nodes = Object.fromEntries(['settings', 'refresh', 'notice', 'connections', 'devices'].map(id => [id, new Element('div')]));
    const selected = {instanceId: INSTANCE, ...local, enabled: true, keyStored: true};
    const request = jest.fn(async route => {
      if (route === '/local/devices') return {devices: [selected]};
      if (route === '/local/instances') return {instances: [{instanceId: INSTANCE, localOnly: true, cloudRefreshAvailable: cloud, deviceCount: 1}]};
      if (route === '/local/names') return {names: [{instanceId: INSTANCE, deviceId: local.deviceId, name: 'Thermostat', roomName: 'Fixture Room'}]};
      if (route === '/local/refresh') return {refreshed: true, restartRequired: true, deviceCount: 1};
      return {stored: true, restartRequired: true};
    });
    const showSchemaForm = jest.fn();
    const getPluginConfig = jest.fn(async () => [{platform: 'FastWarmPlatform', instanceId: INSTANCE}]);
    vm.runInNewContext(script, {window: {homebridge: {request, showSchemaForm, getPluginConfig}}, document: {
      getElementById: (id: string) => nodes[id], createElement: (tag: string) => new Element(tag),
    }});
    await new Promise(resolve => setImmediate(resolve));
    expect(request.mock.calls.map(call => call[0])).toEqual(['/local/devices', '/local/instances', '/local/names']);
    expect(descendants(nodes.devices).find(node => node.tag === 'h3')!.textContent).toBe('Fixture Room');
    const details = descendants(nodes.devices).find(node => node.tag === 'details')!;
    expect(details.attributes.open).toBeUndefined();
    const input = descendants(details).find(node => node.tag === 'input')!, form = descendants(details).find(node => node.tag === 'form')!;
    expect(input.type).toBe('password'); expect(input.value).toBe('');
    input.value = KEY; const saving = form.listeners.submit({preventDefault: jest.fn()}); expect(input.value).toBe(''); await saving;
    expect(request).toHaveBeenCalledWith('/local/key', {instanceId: INSTANCE, deviceId: local.deviceId, localKey: KEY});
    expect(request.mock.calls.filter(call => call[0] === '/local/refresh')).toHaveLength(0);
    const button = descendants(nodes.connections).find(node => node.tag === 'button');
    expect(Boolean(button)).toBe(cloud);
    if (button) {
      const pending = button.listeners.click(); expect(button.disabled).toBe(true); await pending; expect(button.disabled).toBe(false);
      expect(request).toHaveBeenCalledWith('/local/refresh', {instanceId: INSTANCE});
      expect(request.mock.calls.filter(call => call[0] === '/local/refresh')).toHaveLength(1);
    }
    const shown = [...descendants(nodes.connections), ...descendants(nodes.devices)].map(node => node.textContent).join(' ');
    expect(shown).not.toContain(KEY); expect(shown).toContain('Restart the FastWarm child bridge');
    await nodes.settings.listeners.click(); expect(showSchemaForm).toHaveBeenCalledTimes(1);
    expect(script).not.toMatch(/innerHTML|localStorage|sessionStorage|console\.(?:log|error)|\.restart\(/);
  });

  test('new setup generates one secure instance ID in the unsaved UI draft, preserving it on later opens', async () => {
    const html = await fs.readFile(path.join(__dirname, '../homebridge-ui/public/index.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    const nodes = Object.fromEntries(['settings', 'refresh', 'notice', 'connections', 'devices'].map(id => [id, new Element('div')]));
    let draft: unknown[] = [];
    const getPluginConfig = jest.fn(async () => draft);
    const updatePluginConfig = jest.fn(async value => {draft = value; return draft;});
    const showSchemaForm = jest.fn(), savePluginConfig = jest.fn();
    const random = jest.fn(bytes => {
      expect(bytes).toHaveLength(8);
      for (let n = 0; n < bytes.length; n++) bytes[n] = n + 1;
      return bytes;
    });
    const request = jest.fn(async route => route === '/local/devices' ? {devices: []}
      : route === '/local/instances' ? {instances: []} : {names: []});
    vm.runInNewContext(script, {window: {homebridge: {request, getPluginConfig, updatePluginConfig, showSchemaForm, savePluginConfig}},
      crypto: {getRandomValues: random}, document: {
        getElementById: (id: string) => nodes[id], createElement: (tag: string) => new Element(tag),
      },
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(random).not.toHaveBeenCalled(); expect(getPluginConfig).not.toHaveBeenCalled();
    await nodes.settings.listeners.click();
    expect(draft).toEqual([{platform: 'FastWarmPlatform', name: 'FastWarm', instanceId: '0102030405060708', devices: []}]);
    await nodes.settings.listeners.click();
    expect(random).toHaveBeenCalledTimes(1); expect(updatePluginConfig).toHaveBeenCalledTimes(1);
    expect(showSchemaForm).toHaveBeenCalledTimes(2); expect(savePluginConfig).not.toHaveBeenCalled();
    expect(request.mock.calls.map(call => call[0])).toEqual(['/local/devices', '/local/instances', '/local/names']);
    expect(script).not.toMatch(/Math\.random|savePluginConfig/);
  });

  test.each([INSTANCE, '', null, 'invalid-id'])('settings never replaces an existing instance ID, including invalid value %s', async id => {
    const html = await fs.readFile(path.join(__dirname, '../homebridge-ui/public/index.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    const nodes = Object.fromEntries(['settings', 'refresh', 'notice', 'connections', 'devices'].map(key => [key, new Element('div')]));
    const current = [{platform: 'FastWarmPlatform', instanceId: id, devices: [local]}, {platform: 'Unrelated', preserved: true}];
    const updatePluginConfig = jest.fn(), showSchemaForm = jest.fn(), random = jest.fn();
    const request = jest.fn(async route => route === '/local/devices' ? {devices: []}
      : route === '/local/instances' ? {instances: []} : {names: []});
    vm.runInNewContext(script, {window: {homebridge: {request, getPluginConfig: async () => current, updatePluginConfig, showSchemaForm}},
      crypto: {getRandomValues: random}, document: {
        getElementById: (key: string) => nodes[key], createElement: (tag: string) => new Element(tag),
      },
    });
    await new Promise(resolve => setImmediate(resolve));
    await nodes.settings.listeners.click();
    expect(current[0].instanceId).toBe(id); expect(updatePluginConfig).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled(); expect(showSchemaForm).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.map(call => call[0])).toEqual(['/local/devices', '/local/instances', '/local/names']);
  });

  test('only a missing FastWarm instance ID is added, preserving every other draft field and config block', async () => {
    const html = await fs.readFile(path.join(__dirname, '../homebridge-ui/public/index.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    const nodes = Object.fromEntries(['settings', 'refresh', 'notice', 'connections', 'devices'].map(key => [key, new Element('div')]));
    const current = [{platform: 'FastWarmPlatform', name: 'Existing', devices: [local], custom: true},
      {platform: 'FastWarmPlatform', instanceId: INSTANCE, devices: []}, {platform: 'Unrelated', preserved: true}];
    const updatePluginConfig = jest.fn(async value => value), showSchemaForm = jest.fn();
    const request = jest.fn(async route => route === '/local/devices' ? {devices: []}
      : route === '/local/instances' ? {instances: []} : {names: []});
    vm.runInNewContext(script, {window: {homebridge: {request, getPluginConfig: async () => current, updatePluginConfig, showSchemaForm}},
      crypto: {getRandomValues: bytes => {bytes.fill(255); return bytes;}}, document: {
        getElementById: (key: string) => nodes[key], createElement: (tag: string) => new Element(tag),
      },
    });
    await new Promise(resolve => setImmediate(resolve));
    await nodes.settings.listeners.click();
    expect(updatePluginConfig).toHaveBeenCalledWith([{...current[0], instanceId: 'ffffffffffffffff'}, current[1], current[2]]);
    expect(current[0]).not.toHaveProperty('instanceId'); expect(showSchemaForm).toHaveBeenCalledTimes(1);
  });
});

test('the shipped UI lazy-loads its real compiled metadata importer without a cloud request', async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fastwarm-compiled-ui-')));
  const repository = path.resolve(__dirname, '..');
  try {
    // Compile into an isolated package so this regression also works before the repository has a dist directory.
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--project', path.join(repository, 'tsconfig.json'),
      '--outDir', path.join(directory, 'dist'), '--pretty', 'false'], {cwd: repository, timeout: 20000});
    await fs.mkdir(path.join(directory, 'homebridge-ui'));
    await fs.copyFile(path.join(repository, 'homebridge-ui/server.js'), path.join(directory, 'homebridge-ui/server.js'));
    await fs.copyFile(path.join(repository, 'package.json'), path.join(directory, 'package.json'));
    await fs.symlink(path.join(repository, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
    await fs.mkdir(path.join(directory, 'persist'), {mode: 0o700});
    // The dummy endpoint is deliberately invalid. The real importer must validate it without authenticating.
    await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({platforms: [platform()]}), {mode: 0o600});
    const check = `
      const assert = require('node:assert/strict'), path = require('node:path'), https = require('node:https');
      let requests = 0;
      https.request = () => { requests++; throw Error('No network is allowed in this regression.'); };
      (async () => {
        const handlers = require('./homebridge-ui/server.js').createLocalSetupHandlers({storagePath: process.cwd()});
        await assert.rejects(handlers['/local/refresh']({instanceId: '${INSTANCE}'}));
        const imported = require.cache[path.join(process.cwd(), 'dist/cloud/FastWarmCloudMetadataRefresh.js')];
        assert.equal(typeof imported?.exports.refreshFastWarmCloudMetadata, 'function', 'The installed importer path must load');
        assert.equal(requests, 0);
        console.log('compiled-importer-loaded-without-cloud');
      })().catch(error => {console.error(error); process.exitCode = 1;});
    `;
    expect(execFileSync(process.execPath, ['-e', check], {cwd: directory, timeout: 10000, encoding: 'utf8'}))
      .toContain('compiled-importer-loaded-without-cloud');
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
}, 35000);
