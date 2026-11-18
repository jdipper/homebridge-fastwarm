import TuyaOpenMQ, {TuyaMQConnectionEvent} from '../../src/core/TuyaOpenMQ';

/** Test-only events for the unchanged scheduler's former transport-neutral regression cases. */
export default class RawBusFixture extends TuyaOpenMQ {
  config?: object;
  private readonly testRaw = new Set<(topic: string, protocol: number, message: unknown, receivedAt: number) => void>();
  private readonly testConnections = new Set<(event: TuyaMQConnectionEvent) => void>();

  isConnected(): boolean {return true;}
  addRawMessageListener(fn: (topic: string, protocol: number, message: unknown, receivedAt: number) => void): void {this.testRaw.add(fn);}
  removeRawMessageListener(fn: (topic: string, protocol: number, message: unknown, receivedAt: number) => void): void {this.testRaw.delete(fn);}
  addConnectionListener(fn: (event: TuyaMQConnectionEvent) => void): void {this.testConnections.add(fn);}
  removeConnectionListener(fn: (event: TuyaMQConnectionEvent) => void): void {this.testConnections.delete(fn);}
  _decodeMQMessage(): string {throw new Error('A test must supply its own decoded report');}
  async _onMessage(topic: string, bytes: Buffer): Promise<void> {
    const envelope = JSON.parse(bytes.toString()), message = JSON.parse(this._decodeMQMessage());
    for (const fn of this.testRaw) fn(topic, envelope.protocol, message, envelope.t);
  }
  _onConnect(): void {
    for (const fn of this.testConnections) fn({connected: true, recoveryRequired: false});
  }
}
