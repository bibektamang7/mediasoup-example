import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import * as mediasoup from "mediasoup";
import { Worker, WorkerLogTag } from "mediasoup/node/lib/types";
import cors from "cors";
import path from "path";
import { config } from "./config/mediasoup";
import { Room } from "./lib/Room";
import { Peer } from "./lib/Peer";

const app = express();
const server = createServer(app);
const io = new Server(server, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"],
	},
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// MediaSoup worker and rooms
let worker: Worker;
const rooms = new Map<string, Room>();

// Initialize MediaSoup
async function initializeMediaSoup() {
	try {
		worker = await mediasoup.createWorker({
			rtcMinPort: config.worker.rtcMinPort,
			rtcMaxPort: config.worker.rtcMaxPort,
			logLevel: config.worker.logLevel,
			logTags: config.worker.logTags as WorkerLogTag[],
		});

		console.log("MediaSoup worker created");

		worker.on("died", () => {
			console.error("MediaSoup worker died, exiting...");
			process.exit(1);
		});

		return worker;
	} catch (error) {
		console.error("Failed to create MediaSoup worker:", error);
		process.exit(1);
	}
}

// Get or create room
async function getOrCreateRoom(roomId: string): Promise<Room> {
	let room = rooms.get(roomId);

	if (!room) {
		const router = await worker.createRouter({
			mediaCodecs: config.router.mediaCodecs,
		});

		room = new Room(roomId, router);
		rooms.set(roomId, room);

		console.log(`Created room: ${roomId}`);
	}

	return room;
}

// Socket.IO connection handling
io.on("connection", (socket) => {
	console.log("Client connected:", socket.id);

	let currentRoom: Room | null = null;
	let currentPeer: Peer | null = null;

	// Join room
	socket.on("joinRoom", async ({ roomName }) => {
		try {
			console.log(`${socket.id} joining room: ${roomName}`);

			currentRoom = await getOrCreateRoom(roomName);
			currentPeer = new Peer(socket.id, socket);
			currentRoom.addPeer(currentPeer);

			socket.join(roomName);
			console.log(`${socket.id} joined room: ${roomName}`);
		} catch (error) {
			console.error("Error joining room:", error);
			socket.emit("error", { message: "Failed to join room" });
		}
	});

	// Get router RTP capabilities
	socket.on("getRouterRtpCapabilities", (callback) => {
		if (!currentRoom) {
			callback({ error: "Not in a room" });
			return;
		}

		try {
			const rtpCapabilities = currentRoom.router.rtpCapabilities;
			callback(rtpCapabilities);
		} catch (error) {
			console.error("Error getting RTP capabilities:", error);
			callback({ error: "Failed to get RTP capabilities" });
		}
	});

	// Create WebRTC transport
	socket.on("createWebRtcTransport", async ({ sender }, callback) => {
		if (!currentRoom || !currentPeer) {
			callback({ error: "Not in a room" });
			return;
		}

		try {
			const transport = await currentRoom.router.createWebRtcTransport({
				listenIps: config.webRtcTransport.listenIps,
				enableUdp: true,
				enableTcp: true,
				preferUdp: true,
				initialAvailableOutgoingBitrate:
					config.webRtcTransport.initialAvailableOutgoingBitrate,
			});

			transport.on("dtlsstatechange", (dtlsState) => {
				if (dtlsState === "closed") {
					transport.close();
				}
			});

			// transport.on("close", () => {
			// 	console.log("Transport closed");
			// });

			currentPeer.addTransport(transport);

			callback({
				id: transport.id,
				iceParameters: transport.iceParameters,
				iceCandidates: transport.iceCandidates,
				dtlsParameters: transport.dtlsParameters,
			});
		} catch (error) {
			console.error("Error creating WebRTC transport:", error);
			callback({ error: "Failed to create transport" });
		}
	});

	// Connect transport
	socket.on("connectTransport", async ({ transportId, dtlsParameters }) => {
		if (!currentPeer) {
			return;
		}

		try {
			const transport = currentPeer.getTransport(transportId);
			if (!transport) {
				console.error("Transport not found:", transportId);
				return;
			}

			await transport.connect({ dtlsParameters });
			console.log("Transport connected");
		} catch (error) {
			console.error("Error connecting transport:", error);
		}
	});

	// Produce media
	socket.on(
		"produce",
		async ({ kind, rtpParameters, transportId }, callback) => {
			if (!currentRoom || !currentPeer) {
				callback({ error: "Not in a room" });
				return;
			}

			try {
				const transport = currentPeer.getTransport(transportId);
				if (!transport) {
					callback({ error: "Transport not found" });
					return;
				}

				const producer = await transport.produce({
					kind,
					rtpParameters,
				});

				producer.on("transportclose", () => {
					console.log("Producer transport closed");
					producer.close();
				});

				currentPeer.addProducer(producer);

				// Notify other peers about new producer
				currentRoom.broadcastToOthers(socket.id, "newProducer", {
					producerId: producer.id,
					kind: producer.kind,
				});

				callback({ id: producer.id });
				console.log("Producer created:", producer.id);
			} catch (error) {
				console.error("Error producing:", error);
				callback({ error: "Failed to produce" });
			}
		}
	);

	// Consume media
	socket.on("consume", async ({ producerId, rtpCapabilities }, callback) => {
		if (!currentRoom || !currentPeer) {
			callback({ error: "Not in a room" });
			return;
		}

		try {
			// Find the producer
			let producer = null;
			for (const peer of currentRoom.peers.values()) {
				producer = peer.getProducer(producerId);
				if (producer) break;
			}

			if (!producer) {
				callback({ error: "Producer not found" });
				return;
			}

			// Check if router can consume
			if (
				!currentRoom.router.canConsume({
					producerId,
					rtpCapabilities,
				})
			) {
				callback({ error: "Cannot consume" });
				return;
			}

			// Get consumer transport
			const consumerTransport = Array.from(
				currentPeer.transports.values()
			).find((t) => t.appData.consuming);

			if (!consumerTransport) {
				callback({ error: "No consumer transport" });
				return;
			}

			const consumer = await consumerTransport.consume({
				producerId,
				rtpCapabilities,
				paused: true,
			});

			consumer.on("transportclose", () => {
				console.log("Consumer transport closed");
				consumer.close();
			});

			consumer.on("producerclose", () => {
				console.log("Consumer producer closed");
				consumer.close();
				currentPeer?.removeConsumer(consumer.id);
			});

			currentPeer.addConsumer(consumer);

			callback({
				id: consumer.id,
				producerId,
				kind: consumer.kind,
				rtpParameters: consumer.rtpParameters,
			});

			console.log("Consumer created:", consumer.id);
		} catch (error) {
			console.error("Error consuming:", error);
			callback({ error: "Failed to consume" });
		}
	});

	// Resume consumer
	socket.on("resume", async ({ consumerId }) => {
		if (!currentPeer) {
			return;
		}

		try {
			const consumer = currentPeer.getConsumer(consumerId);
			if (!consumer) {
				console.error("Consumer not found:", consumerId);
				return;
			}

			await consumer.resume();
			console.log("Consumer resumed:", consumerId);
		} catch (error) {
			console.error("Error resuming consumer:", error);
		}
	});

	// Get existing producers
	socket.on("getProducers", (callback) => {
		if (!currentRoom) {
			callback([]);
			return;
		}

		const producerIds: string[] = [];
		currentRoom.peers.forEach((peer) => {
			if (peer.id !== socket.id) {
				peer.producers.forEach((producer) => {
					producerIds.push(producer.id);
				});
			}
		});

		callback(producerIds);
	});

	// Handle disconnect
	socket.on("disconnect", () => {
		console.log("Client disconnected:", socket.id);

		if (currentRoom && currentPeer) {
			// Notify other peers about producer closure
			currentPeer.producers.forEach((producer) => {
				currentRoom!.broadcastToOthers(socket.id, "producerClosed", {
					producerId: producer.id,
				});
			});

			// Clean up peer
			currentPeer.close();
			currentRoom.removePeer(socket.id);

			// Clean up room if empty
			if (currentRoom.peers.size === 0) {
				rooms.delete(currentRoom.id);
				console.log(`Room ${currentRoom.id} deleted`);
			}
		}
	});
});

// Health check endpoint
app.get("/health", (req, res) => {
	res.json({ status: "OK", rooms: rooms.size });
});

// Start server
const PORT = process.env.PORT || 3000;

initializeMediaSoup().then(() => {
	server.listen(PORT, () => {
		console.log(`MediaSoup server running on port ${PORT}`);
	});
});

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("Shutting down server...");

	// Close all rooms
	rooms.forEach((room) => {
		room.close();
	});

	// Close worker
	if (worker) {
		worker.close();
	}

	process.exit(0);
});
