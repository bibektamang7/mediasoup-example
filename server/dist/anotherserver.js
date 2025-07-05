"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = __importDefault(require("ws"));
const mediasoup = __importStar(require("mediasoup"));
const uuid_1 = require("uuid");
// Global state
let worker;
let rooms = {};
let peers = {};
let transports = [];
let producers = [];
let consumers = [];
// Media codecs configuration
const mediaCodecs = [
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
const createWorker = async () => {
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
const createRoom = async (roomName, socketId) => {
    let router;
    let roomPeers = [];
    if (rooms[roomName]) {
        router = rooms[roomName].router;
        roomPeers = rooms[roomName].peers || [];
    }
    else {
        router = await worker.createRouter({ mediaCodecs });
    }
    rooms[roomName] = {
        router,
        peers: [...roomPeers, socketId],
    };
    return router;
};
// Create WebRTC transport
const createWebRtcTransport = async (router) => {
    const webRtcTransportOptions = {
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
const removeItems = (items, socketId, type) => {
    items.forEach((item) => {
        if (item.socketId === socketId) {
            item[type].close();
        }
    });
    return items.filter((item) => item.socketId !== socketId);
};
const addTransport = (socketId, transport, roomName, consumer) => {
    transports = [...transports, { socketId, transport, roomName, consumer }];
    peers[socketId] = {
        ...peers[socketId],
        transports: [...peers[socketId].transports, transport.id],
    };
};
const addProducer = (socketId, producer, roomName) => {
    producers = [...producers, { socketId, producer, roomName }];
    peers[socketId] = {
        ...peers[socketId],
        producers: [...peers[socketId].producers, producer.id],
    };
};
const addConsumer = (socketId, consumer, roomName) => {
    consumers = [...consumers, { socketId, consumer, roomName }];
    peers[socketId] = {
        ...peers[socketId],
        consumers: [...peers[socketId].consumers, consumer.id],
    };
};
const getTransport = (socketId) => {
    const transportData = transports.find((transport) => transport.socketId === socketId && !transport.consumer);
    return transportData.transport;
};
const informConsumers = (roomName, socketId, producerId) => {
    const room = rooms[roomName];
    if (!room) {
        console.error(`Room ${roomName} not found`);
        return;
    }
    const peersInRoom = room.peers.filter((peerId) => socketId !== peerId);
    peersInRoom.forEach((peer) => {
        const socketPeer = peers[peer].socket;
        const message = {
            type: "new-producer",
            data: { producerId },
        };
        socketPeer.send(JSON.stringify(message));
    });
};
const sendResponse = (ws, type, data, id) => {
    const message = { type, data, id };
    ws.send(JSON.stringify(message));
};
// WebSocket Server
const wss = new ws_1.default.Server({ port: 8001 });
wss.on("connection", (ws) => {
    const socketId = (0, uuid_1.v4)();
    console.log(`Client connected: ${socketId}`);
    sendResponse(ws, "connection-success", { socketId });
    ws.on("message", async (message) => {
        try {
            const { type, data, id } = JSON.parse(message);
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
                    }
                    catch (error) {
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
                    sendResponse(ws, "transport-produce-response", {
                        id: producer.id,
                        producersExist: producers.length > 1,
                    }, id);
                    break;
                case "getProducers":
                    const currentRoomName = peers[socketId].roomName;
                    let producerList = [];
                    producers.forEach((producerData) => {
                        if (producerData.socketId !== socketId &&
                            producerData.roomName === currentRoomName) {
                            producerList.push(producerData.producer.id);
                        }
                    });
                    sendResponse(ws, "getProducers-response", producerList, id);
                    break;
                case "transport-recv-connect":
                    const { dtlsParameters: consumerDtlsParams, serverConsumerTransportId, } = data;
                    console.log(`DTLS PARAMS: ${consumerDtlsParams}`);
                    const consumerTransport = transports.find((transportData) => transportData.consumer &&
                        transportData.transport.id === serverConsumerTransportId)?.transport;
                    if (consumerTransport) {
                        await consumerTransport.connect({
                            dtlsParameters: consumerDtlsParams,
                        });
                    }
                    break;
                case "consume":
                    const { rtpCapabilities: consumerRtpCapabilities, remoteProducerId, serverConsumerTransportId: consumerTransportId, } = data;
                    try {
                        const consumerRoomName = peers[socketId].roomName;
                        const consumerRouter = rooms[consumerRoomName].router;
                        const consumerTransportData = transports.find((transportData) => transportData.consumer &&
                            transportData.transport.id === consumerTransportId);
                        if (!consumerTransportData) {
                            throw new Error("Consumer transport not found");
                        }
                        const consumerTransportInstance = consumerTransportData.transport;
                        if (consumerRouter.canConsume({
                            producerId: remoteProducerId,
                            rtpCapabilities: consumerRtpCapabilities,
                        })) {
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
                                transports = transports.filter((transportData) => transportData.transport.id !== consumerTransportInstance.id);
                                consumer.close();
                                consumers = consumers.filter((consumerData) => consumerData.consumer.id !== consumer.id);
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
                    }
                    catch (error) {
                        console.error("Error in consume:", error);
                        sendResponse(ws, "consume-response", { params: { error } }, id);
                    }
                    break;
                case "consumer-resume":
                    const { serverConsumerId } = data;
                    console.log("Consumer resume");
                    const consumerData = consumers.find((consumerData) => consumerData.consumer.id === serverConsumerId);
                    if (consumerData) {
                        await consumerData.consumer.resume();
                    }
                    break;
                default:
                    console.log("Unknown message type:", type);
            }
        }
        catch (error) {
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
exports.default = wss;
