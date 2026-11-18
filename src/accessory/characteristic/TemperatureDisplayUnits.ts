import { Service } from 'homebridge';
import { TuyaDeviceSchema } from '../../device/TuyaDevice';
import BaseAccessory from '../BaseAccessory';

export function configureTempDisplayUnits(accessory: BaseAccessory, service: Service, schema?: TuyaDeviceSchema) {
  if (!schema) {
    return;
  }

  const { CELSIUS, FAHRENHEIT } = accessory.Characteristic.TemperatureDisplayUnits;
  service.getCharacteristic(accessory.Characteristic.TemperatureDisplayUnits)
    .onGet(() => {
      accessory.checkOnlineStatus();
      const status = accessory.getStatus(schema.code);
      if (!status || typeof status.value !== 'string' || !['c', 'f'].includes(status.value.toLowerCase())) {
        const {HapStatusError, HAPStatus} = accessory.platform.api.hap;
        throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
      return ((status.value as string).toLowerCase() === 'c') ? CELSIUS : FAHRENHEIT;
    })
    .onSet(async value => {
      accessory.checkOnlineStatus();
      const status = accessory.getStatus(schema.code);
      if (!status || typeof status.value !== 'string' || !['c', 'f'].includes(status.value.toLowerCase())) {
        const {HapStatusError, HAPStatus} = accessory.platform.api.hap;
        throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
      const isLowerCase = (status.value as string).toLowerCase() === status.value;

      let unit = (value === CELSIUS) ? 'c' : 'f';
      unit = isLowerCase ? unit.toLowerCase() : unit.toUpperCase();
      await accessory.sendCommands([{
        code: schema.code,
        value: unit,
      }]);
    });
}
