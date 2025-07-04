// lib/Room.ts
import { Router } from "mediasoup/node/lib/types";
import { Peer } from "./Peer";

export class Room {
	public id: string;
	public router: Router;
	public peers: Map<string, Peer>;

	constructor(id: string, router: Router) {
		this.id = id;
		this.router = router;
		this.peers = new Map();
	}

	addPeer(peer: Peer): void {
		this.peers.set(peer.id, peer);
	}

	removePeer(peerId: string): void {
		this.peers.delete(peerId);
	}

	getPeer(peerId: string): Peer | undefined {
		return this.peers.get(peerId);
	}

	getOtherPeers(peerId: string): Peer[] {
		return Array.from(this.peers.values()).filter((peer) => peer.id !== peerId);
	}

	broadcastToOthers(senderId: string, event: string, data: any): void {
		this.getOtherPeers(senderId).forEach((peer) => {
			peer.socket.emit(event, data);
		});
	}

	close(): void {
		this.peers.forEach((peer) => {
			peer.socket.disconnect();
		});
		this.peers.clear();
	}
}
