import type {API} from 'homebridge';
import {FastWarmPlatform, PLATFORM_NAME, PLUGIN_NAME} from './platform';

export = (api: API) => api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, FastWarmPlatform);
