/* eslint-disable @typescript-eslint/no-unused-vars */
/** Legacy type seam for the proven schedule engine. This class has no HTTP implementation. */
export interface TuyaRequestOptions {
  shouldProceed?: () => boolean;
  attempts?: number;
  timeoutMs?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TuyaOpenAPIResponse = {success: true; result: any; t: number; tid: string}
  | {success: false; result: unknown; code: number; msg: string; t: number; tid: string};

const DENIED = 'The FastWarm provider uses local connections only. Cloud requests are unavailable.';

export default class TuyaOpenAPI {
  static readonly Endpoints = Object.freeze({EUROPE: 'https://openapi.tuyaeu.com'});
  readonly tokenInfo = {access_token: '', refresh_token: '', uid: '', expire: 0};
  readonly tokenRecoveryCount = 0;

  constructor(_endpoint = '', _accessId = '', _accessKey = '', _lang = 'en', _debug = false, _forceIPv4 = false) {
    return;
  }

  async request(_method: string, _path: string, _params?, _body?, _options: TuyaRequestOptions = {}): Promise<TuyaOpenAPIResponse> {
    throw new Error(DENIED);
  }

  get(path: string, params?): Promise<TuyaOpenAPIResponse> {
    return this.request('get', path, params);
  }

  post(path: string, body?): Promise<TuyaOpenAPIResponse> {
    return this.request('post', path, null, body);
  }

  postOnce(path: string, body?, options: TuyaRequestOptions = {}): Promise<TuyaOpenAPIResponse> {
    return this.request('post', path, null, body, {...options, attempts: 1});
  }

  delete(path: string, params?): Promise<TuyaOpenAPIResponse> {
    return this.request('delete', path, params);
  }
}
