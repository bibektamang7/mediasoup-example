"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Peer = void 0;
class Peer {
    constructor(id, socket) {
        this.id = id;
        this.socket = socket;
        this.transports = new Map();
        this.producers = new Map();
        this.consumers = new Map();
    }
    addTransport(transport) {
        this.transports.set(transport.id, transport);
    }
    removeTransport(transportId) {
        this.transports.delete(transportId);
    }
    getTransport(transportId) {
        return this.transports.get(transportId);
    }
    addProducer(producer) {
        this.producers.set(producer.id, producer);
    }
    removeProducer(producerId) {
        this.producers.delete(producerId);
    }
    getProducer(producerId) {
        return this.producers.get(producerId);
    }
    addConsumer(consumer) {
        this.consumers.set(consumer.id, consumer);
    }
    removeConsumer(consumerId) {
        this.consumers.delete(consumerId);
    }
    getConsumer(consumerId) {
        return this.consumers.get(consumerId);
    }
    close() {
        this.transports.forEach(transport => transport.close());
        this.producers.forEach(producer => producer.close());
        this.consumers.forEach(consumer => consumer.close());
        this.transports.clear();
        this.producers.clear();
        this.consumers.clear();
    }
}
exports.Peer = Peer;
