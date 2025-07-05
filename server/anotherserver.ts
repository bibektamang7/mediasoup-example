import WebSocket from "ws";
import * as mediasoup from "mediasoup";
import { v4 as uuidv4 } from "uuid";

// Types
interface PeerDetails {
	name: string;
	isAdmin: boolean;
}

interface Peer {
	socket: WebSocket;
	roomName: string;
	transports: string[];
	producers: string[];
	consumers: string[];
	peerDetails: PeerDetails;
}

interface Room {
	router: mediasoup.types.Router;
	peers: string[];
}

interface TransportData {
	socketId: string;
	transport: mediasoup.types.WebRtcTransport;
	roomName: string;
	consumer: boolean;
}

interface ProducerData {
	socketId: string;
	producer: mediasoup.types.Producer;
	roomName: string;
}

interface ConsumerData {
	socketId: string;
	consumer: mediasoup.types.Consumer;
	roomName: string;
}

interface WebSocketMessage {
	type: string;
	data: any;
	id?: string;
}

// Global state
let worker: mediasoup.types.Worker;
let rooms: Record<string, Room> = {};
let peers: Record<string, Peer> = {};
let transports: TransportData[] = [];
let producers: ProducerData[] = [];
let consumers: ConsumerData[] = [];

// Media codecs configuration
const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
	{
		kind: "audio",
		mimeType: "audio/opus",
		clockRate: 48000,
		channels: 2,
	},
	{
		kind: "video",
		mimeType: "video/VP8",
		clockRate: 90000,
		parameters: {
			"x-google-start-bitrate": 1000,
		},
	},
];

// Create mediasoup worker
const createWorker = async (): Promise<mediasoup.types.Worker> => {
	const newWorker = await mediasoup.createWorker({
		rtcMinPort: 2000,
		rtcMaxPort: 2020,
	});

	console.log(`Worker pid ${newWorker.pid}`);

	newWorker.on("died", (error) => {
		console.error("Mediasoup worker has died", error);
		setTimeout(() => process.exit(1), 2000);
	});

	return newWorker;
};

// Initialize worker
const initializeWorker = async () => {
	worker = await createWorker();
};

// Create room
const createRoom = async (
	roomName: string,
	socketId: string
): Promise<mediasoup.types.Router> => {
	let router: mediasoup.types.Router;
	let roomPeers: string[] = [];

	if (rooms[roomName]) {
		router = rooms[roomName].router;
		roomPeers = rooms[roomName].peers || [];
	} else {
		router = await worker.createRouter({ mediaCodecs });
	}

	rooms[roomName] = {
		router,
		peers: [...roomPeers, socketId],
	};

	return router;
};

// Create WebRTC transport
const createWebRtcTransport = async (
	router: mediasoup.types.Router
): Promise<mediasoup.types.WebRtcTransport> => {
	const webRtcTransportOptions: mediasoup.types.WebRtcTransportOptions = {
		// listenIps: [
		// 	{
		// 		ip: "0.0.0.0",
		// 		announcedIp: "103.225.244.89",
		// 	},
		// ],

		enableUdp: true,
		enableTcp: true,
		preferUdp: true,
		listenInfos: [
			{
				ip: "0.0.0.0",
				announcedIp: "103.225.244.89",
				protocol: "tcp",
				portRange: {
					min: 40000,
					max: 49999,
				},
			},
			{
				ip: "0.0.0.0",
				announcedIp: "103.225.244.89",
				protocol: "udp",
				portRange: {
					min: 40000,
					max: 49999,
				},
			},
		],
		initialAvailableOutgoingBitrate: 1000000, // 1 Mbps
		maxSctpMessageSize: 262144, // 256 KB
	};

	const transport = await router.createWebRtcTransport({
		...webRtcTransportOptions,
	});
	console.log(`Transport id: ${transport.id}`);

	transport.on("dtlsstatechange", (dtlsState) => {
		if (dtlsState === "closed") {
			transport.close();
		}
	});

	//   transport.on('close', () => {
	//     console.log('Transport closed');
	//   });

	return transport;
};

// Utility functions
const removeItems = (items: any[], socketId: string, type: string): any[] => {
	items.forEach((item) => {
		if (item.socketId === socketId) {
			item[type].close();
		}
	});
	return items.filter((item) => item.socketId !== socketId);
};

const addTransport = (
	socketId: string,
	transport: mediasoup.types.WebRtcTransport,
	roomName: string,
	consumer: boolean
) => {
	transports = [...transports, { socketId, transport, roomName, consumer }];

	peers[socketId] = {
		...peers[socketId],
		transports: [...peers[socketId].transports, transport.id],
	};
};

const addProducer = (
	socketId: string,
	producer: mediasoup.types.Producer,
	roomName: string
) => {
	producers = [...producers, { socketId, producer, roomName }];

	peers[socketId] = {
		...peers[socketId],
		producers: [...peers[socketId].producers, producer.id],
	};
};

const addConsumer = (
	socketId: string,
	consumer: mediasoup.types.Consumer,
	roomName: string
) => {
	consumers = [...consumers, { socketId, consumer, roomName }];

	peers[socketId] = {
		...peers[socketId],
		consumers: [...peers[socketId].consumers, consumer.id],
	};
};

const getTransport = (socketId: string): mediasoup.types.WebRtcTransport => {
	const transportData = transports.find(
		(transport) => transport.socketId === socketId && !transport.consumer
	);
	return transportData!.transport;
};

const informConsumers = (
	roomName: string,
	socketId: string,
	producerId: string
) => {
	const room = rooms[roomName];
	if (!room) {
		console.error(`Room ${roomName} not found`);
		return;
	}
	const peersInRoom = room.peers.filter((peerId) => socketId !== peerId);

	peersInRoom.forEach((peer) => {
		const socketPeer = peers[peer].socket;
		const message: WebSocketMessage = {
			type: "new-producer",
			data: { producerId },
		};
		socketPeer.send(JSON.stringify(message));
	});
};

const sendResponse = (ws: WebSocket, type: string, data: any, id?: string) => {
	const message: WebSocketMessage = { type, data, id };
	ws.send(JSON.stringify(message));
};

// WebSocket Server
const wss = new WebSocket.Server({ port: 8001 });

wss.on("connection", (ws: WebSocket) => {
	const socketId = uuidv4();
	console.log(`Client connected: ${socketId}`);

	sendResponse(ws, "connection-success", { socketId });

	ws.on("message", async (message: string) => {
		try {
			const { type, data, id } = JSON.parse(message) as WebSocketMessage;

			switch (type) {
				case "joinRoom":
					const { roomName } = data;
					const router = await createRoom(roomName, socketId);

					peers[socketId] = {
						socket: ws,
						roomName,
						transports: [],
						producers: [],
						consumers: [],
						peerDetails: {
							name: "",
							isAdmin: false,
						},
					};

					const rtpCapabilities = router.rtpCapabilities;
					sendResponse(ws, "joinRoom-response", { rtpCapabilities }, id);
					break;

				case "createWebRtcTransport":
					const { consumer } = data;
					const peerRoomName = peers[socketId].roomName;
					const roomRouter = rooms[peerRoomName].router;

					try {
						const transport = await createWebRtcTransport(roomRouter);
						const params = {
							id: transport.id,
							iceParameters: transport.iceParameters,
							iceCandidates: transport.iceCandidates,
							dtlsParameters: transport.dtlsParameters,
						};

						addTransport(socketId, transport, peerRoomName, consumer);
						sendResponse(ws, "createWebRtcTransport-response", { params }, id);
					} catch (error: any) {
						console.error("Error creating WebRTC transport:", error);
						sendResponse(ws, "error", { error: error.message }, id);
					}
					break;

				case "transport-connect":
					const { dtlsParameters } = data;
					console.log("DTLS PARAMS... ", { dtlsParameters });
					await getTransport(socketId).connect({ dtlsParameters });
					break;

				case "transport-produce":
					const { kind, rtpParameters, appData } = data;
					const producer = await getTransport(socketId).produce({
						kind,
						rtpParameters,
					});

					const producerRoomName = peers[socketId].roomName;
					addProducer(socketId, producer, producerRoomName);
					informConsumers(producerRoomName, socketId, producer.id);

					console.log("Producer ID: ", producer.id, producer.kind);

					producer.on("transportclose", () => {
						console.log("Transport for this producer closed");
						producer.close();
					});

					sendResponse(
						ws,
						"transport-produce-response",
						{
							id: producer.id,
							producersExist: producers.length > 1,
						},
						id
					);
					break;

				case "getProducers":
					const currentRoomName = peers[socketId].roomName;
					let producerList: string[] = [];

					producers.forEach((producerData) => {
						if (
							producerData.socketId !== socketId &&
							producerData.roomName === currentRoomName
						) {
							producerList.push(producerData.producer.id);
						}
					});

					sendResponse(ws, "getProducers-response", producerList, id);
					break;

				case "transport-recv-connect":
					const {
						dtlsParameters: consumerDtlsParams,
						serverConsumerTransportId,
					} = data;
					console.log(`DTLS PARAMS: ${consumerDtlsParams}`);

					const consumerTransport = transports.find(
						(transportData) =>
							transportData.consumer &&
							transportData.transport.id === serverConsumerTransportId
					)?.transport;

					if (consumerTransport) {
						await consumerTransport.connect({
							dtlsParameters: consumerDtlsParams,
						});
					}
					break;

				case "consume":
					const {
						rtpCapabilities: consumerRtpCapabilities,
						remoteProducerId,
						serverConsumerTransportId: consumerTransportId,
					} = data;

					try {
						const consumerRoomName = peers[socketId].roomName;
						const consumerRouter = rooms[consumerRoomName].router;
						const consumerTransportData = transports.find(
							(transportData) =>
								transportData.consumer &&
								transportData.transport.id === consumerTransportId
						);

						if (!consumerTransportData) {
							throw new Error("Consumer transport not found");
						}

						const consumerTransportInstance = consumerTransportData.transport;

						if (
							consumerRouter.canConsume({
								producerId: remoteProducerId,
								rtpCapabilities: consumerRtpCapabilities,
							})
						) {
							const consumer = await consumerTransportInstance.consume({
								producerId: remoteProducerId,
								rtpCapabilities: consumerRtpCapabilities,
								paused: true,
							});

							consumer.on("transportclose", () => {
								console.log("Transport close from consumer");
							});

							consumer.on("producerclose", () => {
								console.log("Producer of consumer closed");
								sendResponse(ws, "producer-closed", { remoteProducerId });

								consumerTransportInstance.close();
								transports = transports.filter(
									(transportData) =>
										transportData.transport.id !== consumerTransportInstance.id
								);
								consumer.close();
								consumers = consumers.filter(
									(consumerData) => consumerData.consumer.id !== consumer.id
								);
							});

							addConsumer(socketId, consumer, consumerRoomName);

							const params = {
								id: consumer.id,
								producerId: remoteProducerId,
								kind: consumer.kind,
								rtpParameters: consumer.rtpParameters,
								serverConsumerId: consumer.id,
							};

							sendResponse(ws, "consume-response", { params }, id);
						}
					} catch (error) {
						console.error("Error in consume:", error);
						sendResponse(ws, "consume-response", { params: { error } }, id);
					}
					break;

				case "consumer-resume":
					const { serverConsumerId } = data;
					console.log("Consumer resume");

					const consumerData = consumers.find(
						(consumerData) => consumerData.consumer.id === serverConsumerId
					);

					if (consumerData) {
						await consumerData.consumer.resume();
					}
					break;

				default:
					console.log("Unknown message type:", type);
			}
		} catch (error: any) {
			console.error("Error handling message:", error);
			sendResponse(ws, "error", { error: error.message });
		}
	});

	ws.on("close", () => {
		console.log("Peer disconnected");

		// Cleanup
		consumers = removeItems(consumers, socketId, "consumer");
		producers = removeItems(producers, socketId, "producer");
		transports = removeItems(transports, socketId, "transport");

		if (peers[socketId]) {
			const { roomName } = peers[socketId];
			delete peers[socketId];

			// Remove socket from room
			if (rooms[roomName]) {
				rooms[roomName] = {
					router: rooms[roomName].router,
					peers: rooms[roomName].peers.filter((id) => id !== socketId),
				};
			}
		}
	});
});

// Initialize the server
initializeWorker()
	.then(() => {
		console.log("MediaSoup server running on port 8001");
	})
	.catch((error) => {
		console.error("Failed to initialize worker:", error);
		process.exit(1);
	});

export default wss;
