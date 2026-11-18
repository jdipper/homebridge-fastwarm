import TuyaOpenAPI from './TuyaOpenAPI';

export interface TuyaMQConnectionEvent {
  connected: boolean;
  recoveryRequired: boolean;
}
type RawListener = (topic: string, protocol: number, message: unknown, receivedAt: number) => void;
type MessageListener = (topic: string, protocol: number, message: unknown) => void;
type ConnectionListener = (event: TuyaMQConnectionEvent) => void;

/** Inert compatibility bus. It cannot connect, subscribe, decrypt cloud messages or create a timer. */
export default class TuyaOpenMQ {
  private readonly raw = new Set<RawListener>();
  private readonly messages = new Set<MessageListener>();
  private readonly connections = new Set<ConnectionListener>();

  constructor(_api?: TuyaOpenAPI) { // eslint-disable-line @typescript-eslint/no-unused-vars
    return;
  }

  isConnected(): boolean {
    return false;
  }

  start(): void {
    throw new Error('Cloud messaging is unavailable in the FastWarm provider.');
  }

  stop(): void {
    return;
  }

  addRawMessageListener(listener: RawListener): void {
    this.raw.add(listener);
  }

  removeRawMessageListener(listener: RawListener): void {
    this.raw.delete(listener);
  }

  addMessageListener(listener: MessageListener): void {
    this.messages.add(listener);
  }

  removeMessageListener(listener: MessageListener): void {
    this.messages.delete(listener);
  }

  addConnectionListener(listener: ConnectionListener): void {
    this.connections.add(listener);
  }

  removeConnectionListener(listener: ConnectionListener): void {
    this.connections.delete(listener);
  }
}
