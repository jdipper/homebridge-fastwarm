import https from 'https';
import net from 'net';
import TuyaOpenAPI from '../../src/core/TuyaOpenAPI';
import TuyaOpenMQ from '../../src/core/TuyaOpenMQ';

afterEach(() => {jest.restoreAllMocks(); jest.useRealTimers();});

test('all retained HTTP compatibility entry points deny before any network access', async () => {
  const network = jest.spyOn(https, 'request').mockImplementation(() => {throw Error('Unexpected HTTP');});
  const api = new TuyaOpenAPI();
  for (const operation of [() => api.request('get', '/status'), () => api.get('/status'), () => api.post('/commands', {}),
    () => api.postOnce('/properties/issue', {}, {shouldProceed: () => true}), () => api.delete('/scene')]) {
    await expect(operation()).rejects.toThrow('local connections only');
  }
  expect(network).not.toHaveBeenCalled(); expect(api.tokenInfo.access_token).toBe('');
});

test('the compatibility message bus has no connection or renewal lifecycle', () => {
  jest.useFakeTimers(); const tcp = jest.spyOn(net, 'createConnection'), network = jest.spyOn(https, 'request');
  const bus = new TuyaOpenMQ(new TuyaOpenAPI());
  expect(bus.isConnected()).toBe(false); expect(() => bus.start()).toThrow('unavailable'); bus.stop();
  expect(jest.getTimerCount()).toBe(0); expect(tcp).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
});
