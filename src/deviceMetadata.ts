import TuyaDevice, {TuyaDeviceSchemaMode as Mode, TuyaDeviceSchemaType as Type} from './device/TuyaDevice';
import {readFastWarmLanMetadata} from './device/lan/FastWarmLanBootstrap';
import {FASTWARM_CURRENT_TEMPERATURE_SCHEMA} from './device/profile/FastWarmThermostat';
import type {FastWarmDeviceConfig} from './config';

/** The only supported model. New devices must authenticate and provide native controls before they become available. */
export function et63Metadata(config: FastWarmDeviceConfig): TuyaDevice {
  return new TuyaDevice({id: config.deviceId, uuid: config.deviceId, name: config.name ?? config.roomName ?? 'FastWarm thermostat',
    model: 'ET-63', product_id: 'lmtejj3f4kafi2k1', product_name: 'FastWarm WiFi 2.0 ET-63', category: 'wk',
    owner_id: '', online: false, ...(config.roomName ? {room_name: config.roomName} : {}),
    schema: [
      {code: 'switch', mode: Mode.READ_WRITE, type: Type.Boolean, property: {}},
      {code: 'temp_set', mode: Mode.READ_WRITE, type: Type.Integer, property: {min: 41, max: 1040, scale: 1, step: 1, unit: ''}},
      {code: 'temp_unit_convert', mode: Mode.READ_WRITE, type: Type.Enum, property: {range: ['c', 'f']}},
      {...FASTWARM_CURRENT_TEMPERATURE_SCHEMA},
    ], status: []});
}

export async function deviceMetadata(persistPath: string, instanceId: string, selections: FastWarmDeviceConfig[]) {
  const previous = await readFastWarmLanMetadata(persistPath, instanceId);
  const enabled = selections.filter(device => device.enabled !== false);
  let saveNeeded = false;
  const devices = enabled.map(selection => {
    const retained = previous.find(device => device.id === selection.deviceId);
    if (!retained) {
      saveNeeded = true;
    }
    const device = retained ?? et63Metadata(selection);
    device.online = false;
    if (selection.name) {
      device.name = selection.name;
    }
    if (selection.roomName) {
      device.room_name = selection.roomName;
    }
    return device;
  });
  const selected = new Set(devices.map(device => device.id));
  return {devices, saveNeeded, cache: [...previous.filter(device => !selected.has(device.id)), ...devices]};
}
