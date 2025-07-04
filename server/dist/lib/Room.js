"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Room = void 0;
class Room {
    constructor(id, router) {
        this.id = id;
        this.router = router;
        this.peers = new Map();
    }
    addPeer(peer) {
        this.peers.set(peer.id, peer);
    }
    removePeer(peerId) {
        this.peers.delete(peerId);
    }
    getPeer(peerId) {
        return this.peers.get(peerId);
    }
    getOtherPeers(peerId) {
        return Array.from(this.peers.values()).filter((peer) => peer.id !== peerId);
    }
    broadcastToOthers(senderId, event, data) {
        this.getOtherPeers(senderId).forEach((peer) => {
            peer.socket.emit(event, data);
        });
    }
    close() {
        this.peers.forEach((peer) => {
            peer.socket.disconnect();
        });
        this.peers.clear();
    }
}
exports.Room = Room;
