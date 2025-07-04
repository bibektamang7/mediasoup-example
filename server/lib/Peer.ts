import { Socket } from 'socket.io';
import { WebRtcTransport, Producer, Consumer } from 'mediasoup/node/lib/types';

export class Peer {
  public id: string;
  public socket: Socket;
  public transports: Map<string, WebRtcTransport>;
  public producers: Map<string, Producer>;
  public consumers: Map<string, Consumer>;

  constructor(id: string, socket: Socket) {
    this.id = id;
    this.socket = socket;
    this.transports = new Map();
    this.producers = new Map();
    this.consumers = new Map();
  }

  addTransport(transport: WebRtcTransport): void {
    this.transports.set(transport.id, transport);
  }

  removeTransport(transportId: string): void {
    this.transports.delete(transportId);
  }

  getTransport(transportId: string): WebRtcTransport | undefined {
    return this.transports.get(transportId);
  }

  addProducer(producer: Producer): void {
    this.producers.set(producer.id, producer);
  }

  removeProducer(producerId: string): void {
    this.producers.delete(producerId);
  }

  getProducer(producerId: string): Producer | undefined {
    return this.producers.get(producerId);
  }

  addConsumer(consumer: Consumer): void {
    this.consumers.set(consumer.id, consumer);
  }

  removeConsumer(consumerId: string): void {
    this.consumers.delete(consumerId);
  }

  getConsumer(consumerId: string): Consumer | undefined {
    return this.consumers.get(consumerId);
  }

  close(): void {
    this.transports.forEach(transport => transport.close());
    this.producers.forEach(producer => producer.close());
    this.consumers.forEach(consumer => consumer.close());
    this.transports.clear();
    this.producers.clear();
    this.consumers.clear();
  }
}