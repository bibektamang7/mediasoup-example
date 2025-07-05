import React, { useState, useEffect, useRef, useCallback } from "react";
import * as mediasoup from "mediasoup-client";

interface WebSocketMessage {
	type: string;
	data: any;
	id?: string;
}

interface PeerConnection {
	socketId: string;
	producerId: string;
	consumer?: mediasoup.types.Consumer;
	videoElement?: HTMLVideoElement;
}

const MediaSoupClient: React.FC = () => {
	const [isConnected, setIsConnected] = useState(false);
	const [roomName, setRoomName] = useState("");
	const [isJoined, setIsJoined] = useState(false);
	const [isPublishing, setIsPublishing] = useState(false);
	const [peers, setPeers] = useState<PeerConnection[]>([]);
	const [localStream, setLocalStream] = useState<MediaStream | null>(null);

	const wsRef = useRef<WebSocket | null>(null);
	const deviceRef = useRef<mediasoup.types.Device | null>(null);
	const producerTransportRef = useRef<mediasoup.types.Transport | null>(null);
	const consumerTransportRef = useRef<mediasoup.types.Transport | null>(null);
	const producerRef = useRef<mediasoup.types.Producer | null>(null);
	const localVideoRef = useRef<HTMLVideoElement>(null);
	const pendingMessagesRef = useRef<Map<string, (data: any) => void>>(
		new Map()
	);

	const generateId = () => Math.random().toString(36).substring(2, 15);

	const sendMessage = useCallback((type: string, data: any): Promise<any> => {
		return new Promise((resolve, reject) => {
			if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
				reject(new Error("WebSocket not connected"));
				return;
			}

			const id = generateId();
			const message: WebSocketMessage = { type, data, id };

			pendingMessagesRef.current.set(id, resolve);
			wsRef.current.send(JSON.stringify(message));

			// Set timeout for pending messages
			setTimeout(() => {
				if (pendingMessagesRef.current.has(id)) {
					pendingMessagesRef.current.delete(id);
					reject(new Error("Message timeout"));
				}
			}, 10000);
		});
	}, []);

	const sendMessageWithoutResponse = useCallback((type: string, data: any) => {
		if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
			return;
		}

		const message: WebSocketMessage = { type, data };
		wsRef.current.send(JSON.stringify(message));
	}, []);

	const joinRoom = useCallback(async () => {
		if (!roomName.trim()) {
			alert("Please enter a room name");
			return;
		}

		try {
			const response = await sendMessage("joinRoom", { roomName });
			const { rtpCapabilities } = response;

			// Create mediasoup device
			const device = new mediasoup.Device();
			await device.load({ routerRtpCapabilities: rtpCapabilities });
			deviceRef.current = device;

			console.log("RTP Capabilities:", rtpCapabilities);
			console.log("Device loaded successfully");

			setIsJoined(true);
		} catch (error) {
			console.error("Error joining room:", error);
			alert("Failed to join room");
		}
	}, [roomName, sendMessage]);

	const createProducerTransport = useCallback(async () => {
		if (!deviceRef.current) return null;

		try {
			const response = await sendMessage("createWebRtcTransport", {
				consumer: false,
			});
			const { params } = response;

			const producerTransport = deviceRef.current.createSendTransport({
				...params,
				iceServers: [
					{
						urls: "stun:stun.l.google.com:19302",
					},
				],
			});

			producerTransport.on(
				"connect",
				async ({ dtlsParameters }, callback, errback) => {
					try {
						sendMessageWithoutResponse("transport-connect", { dtlsParameters });
						callback();
					} catch (error: any) {
						errback(error);
					}
				}
			);

			producerTransport.on(
				"produce",
				async ({ kind, rtpParameters, appData }, callback, errback) => {
					try {
						const response = await sendMessage("transport-produce", {
							kind,
							rtpParameters,
							appData,
						});
						callback({ id: response.id });
					} catch (error: any) {
						errback(error);
					}
				}
			);

			producerTransportRef.current = producerTransport;
			return producerTransport;
		} catch (error) {
			console.error("Error creating producer transport:", error);
			return null;
		}
	}, [sendMessage, sendMessageWithoutResponse]);

	const createConsumerTransport = useCallback(async () => {
		if (!deviceRef.current) return null;

		try {
			const response = await sendMessage("createWebRtcTransport", {
				consumer: true,
			});
			const { params } = response;

			const consumerTransport = deviceRef.current.createRecvTransport(params);

			consumerTransport.on(
				"connect",
				async ({ dtlsParameters }, callback, errback) => {
					try {
						sendMessageWithoutResponse("transport-recv-connect", {
							dtlsParameters,
							serverConsumerTransportId: params.id,
						});
						callback();
					} catch (error: any) {
						errback(error);
					}
				}
			);

			consumerTransportRef.current = consumerTransport;
			return consumerTransport;
		} catch (error) {
			console.error("Error creating consumer transport:", error);
			return null;
		}
	}, [sendMessage, sendMessageWithoutResponse]);

	const publish = async () => {
		if (!deviceRef.current || !producerTransportRef.current) {
			const transport = await createProducerTransport();
			if (!transport) return;
		}

		try {
			alert("here come so not");
			const stream = await navigator.mediaDevices.getUserMedia({
				video: true,
				audio: true,
			});

			setLocalStream(stream);

			if (localVideoRef.current) {
				localVideoRef.current.srcObject = stream;
			}

			const videoTrack = stream.getVideoTracks()[0];
			const audioTrack = stream.getAudioTracks()[0];

			if (videoTrack) {
				const videoProducer = await producerTransportRef.current!.produce({
					track: videoTrack,
				});
				console.log("Video producer created:", videoProducer.id);
			}

			if (audioTrack) {
				const audioProducer = await producerTransportRef.current!.produce({
					track: audioTrack,
				});
				console.log("Audio producer created:", audioProducer.id);
			}

			setIsPublishing(true);

			// Get existing producers
			const existingProducers = await sendMessage("getProducers", {});
			console.log("Existing producers:", existingProducers);

			// Subscribe to existing producers
			for (const producerId of existingProducers) {
				await consumeProducer(producerId);
			}
		} catch (error) {
			console.error("Error publishing:", error);
			alert("Failed to publish stream");
		}
	};

	const consumeProducer = useCallback(
		async (producerId: string) => {
			if (!deviceRef.current) return;

			try {
				if (!consumerTransportRef.current) {
					await createConsumerTransport();
				}

				if (!consumerTransportRef.current) {
					console.error("Failed to create consumer transport");
					return;
				}

				const response = await sendMessage("consume", {
					rtpCapabilities: deviceRef.current.rtpCapabilities,
					remoteProducerId: producerId,
					serverConsumerTransportId: consumerTransportRef.current.id,
				});

				const { params } = response;

				if (params.error) {
					console.error("Error consuming:", params.error);
					return;
				}

				const consumer = await consumerTransportRef.current.consume({
					id: params.id,
					producerId: params.producerId,
					kind: params.kind,
					rtpParameters: params.rtpParameters,
				});

				// Resume consumer
				sendMessageWithoutResponse("consumer-resume", {
					serverConsumerId: params.serverConsumerId,
				});

				// Create video element for remote stream
				const videoElement = document.createElement("video");
				videoElement.autoplay = true;
				videoElement.playsInline = true;
				videoElement.controls = true;
				videoElement.style.width = "300px";
				videoElement.style.height = "200px";
				videoElement.style.margin = "10px";

				const stream = new MediaStream([consumer.track]);
				videoElement.srcObject = stream;

				// Add to peers state
				setPeers((prev) => [
					...prev,
					{
						socketId: generateId(),
						producerId,
						consumer,
						videoElement,
					},
				]);

				// Add to DOM
				const remoteVideos = document.getElementById("remote-videos");
				if (remoteVideos) {
					remoteVideos.appendChild(videoElement);
				}
			} catch (error) {
				console.error("Error consuming producer:", error);
			}
		},
		[createConsumerTransport, sendMessage, sendMessageWithoutResponse]
	);

	const handleNewProducer = useCallback(
		(producerId: string) => {
			console.log("New producer available:", producerId);
			consumeProducer(producerId);
		},
		[consumeProducer]
	);

	const handleProducerClosed = useCallback((producerId: string) => {
		console.log("Producer closed:", producerId);

		setPeers((prev) => {
			const updatedPeers = prev.filter((peer) => {
				if (peer.producerId === producerId) {
					if (peer.consumer) {
						peer.consumer.close();
					}
					if (peer.videoElement && peer.videoElement.parentNode) {
						peer.videoElement.parentNode.removeChild(peer.videoElement);
					}
					return false;
				}
				return true;
			});
			return updatedPeers;
		});
	}, []);

	const disconnect = useCallback(() => {
		if (localStream) {
			localStream.getTracks().forEach((track) => track.stop());
			setLocalStream(null);
		}

		if (producerRef.current) {
			producerRef.current.close();
			producerRef.current = null;
		}

		if (producerTransportRef.current) {
			producerTransportRef.current.close();
			producerTransportRef.current = null;
		}

		if (consumerTransportRef.current) {
			consumerTransportRef.current.close();
			consumerTransportRef.current = null;
		}

		peers.forEach((peer) => {
			if (peer.consumer) {
				peer.consumer.close();
			}
			if (peer.videoElement && peer.videoElement.parentNode) {
				peer.videoElement.parentNode.removeChild(peer.videoElement);
			}
		});

		setPeers([]);
		setIsPublishing(false);
		setIsJoined(false);

		if (wsRef.current) {
			wsRef.current.close();
		}
	}, [localStream, peers]);

	useEffect(() => {
		if (
			wsRef.current &&
			(wsRef.current.readyState === WebSocket.OPEN ||
				wsRef.current.readyState === WebSocket.CONNECTING)
		) {
			console.log("WebSocket already connected");
			return; // Prevent reconnecting if already connected
		}

		const ws = new WebSocket("ws://192.168.0.101:8001");
		console.log("Connecting to WebSocket...", ws);

		ws.onopen = () => {
			console.log("WebSocket connected");
			setIsConnected(true);
		};

		ws.onmessage = (event) => {
			try {
				const message: WebSocketMessage = JSON.parse(event.data);
				console.log("Received message:", message);

				// Handle response messages
				if (message.id && pendingMessagesRef.current.has(message.id)) {
					const resolve = pendingMessagesRef.current.get(message.id)!;
					pendingMessagesRef.current.delete(message.id);
					resolve(message.data);
					return;
				}

				// Handle event messages
				switch (message.type) {
					case "connection-success":
						console.log("Connected with socket ID:", message.data.socketId);
						break;
					case "new-producer":
						handleNewProducer(message.data.producerId);
						break;
					case "producer-closed":
						handleProducerClosed(message.data.remoteProducerId);
						break;
					default:
						console.log("Unhandled message type:", message.type);
				}
			} catch (error) {
				console.error("Error parsing message:", error);
			}
		};

		wsRef.current = ws;

		return () => {
			disconnect();
		};
	}, []); // Only rerun effect when disconnect function changes

	return (
		<div style={{ padding: "20px", fontFamily: "Arial, sans-serif" }}>
			<h1>MediaSoup WebRTC Client</h1>

			<div style={{ marginBottom: "20px" }}>
				<p>
					Connection Status: {isConnected ? "✅ Connected" : "❌ Disconnected"}
				</p>
			</div>

			{!isJoined ? (
				<div style={{ marginBottom: "20px" }}>
					<input
						type="text"
						value={roomName}
						onChange={(e) => setRoomName(e.target.value)}
						placeholder="Enter room name"
						style={{ padding: "10px", marginRight: "10px", width: "200px" }}
					/>
					<button
						onClick={joinRoom}
						disabled={!isConnected || !roomName.trim()}
						style={{
							padding: "10px 20px",
							backgroundColor: "#007bff",
							color: "white",
							border: "none",
							cursor: "pointer",
						}}
					>
						Join Room
					</button>
				</div>
			) : (
				<div>
					<div style={{ marginBottom: "20px" }}>
						<p>Room: {roomName}</p>
						<button
							onClick={publish}
							disabled={isPublishing}
							style={{
								padding: "10px 20px",
								backgroundColor: isPublishing ? "#28a745" : "#007bff",
								color: "white",
								border: "none",
								cursor: "pointer",
								marginRight: "10px",
							}}
						>
							{isPublishing ? "Publishing..." : "Start Publishing"}
						</button>
						<button
							onClick={disconnect}
							style={{
								padding: "10px 20px",
								backgroundColor: "#dc3545",
								color: "white",
								border: "none",
								cursor: "pointer",
							}}
						>
							Disconnect
						</button>
					</div>

					<div style={{ marginBottom: "20px" }}>
						<h3>Local Video</h3>
						<video
							ref={localVideoRef}
							autoPlay
							playsInline
							muted
							style={{
								width: "300px",
								height: "200px",
								border: "2px solid #007bff",
							}}
						/>
					</div>

					<div>
						<h3>Remote Videos</h3>
						<div
							id="remote-videos"
							style={{ display: "flex", flexWrap: "wrap" }}
						>
							{peers.length === 0 && <p>No remote peers connected</p>}
							{peers.length}
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

export default MediaSoupClient;
