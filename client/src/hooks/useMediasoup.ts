import { useState, useEffect, useRef, useCallback } from "react";
import { Device } from "mediasoup-client";
import { io, Socket } from "socket.io-client";
import { MediaSoupState, SocketEvents } from "../../types/mediasoup";

// const WS_URL = "https://e6c1-103-225-244-3.ngrok-free.app/ws/";
const WS_URL = "http://localhost:3000"; // Use your actual server URL here

export const useMediaSoup = (serverUrl: string = WS_URL) => {
	const [state, setState] = useState<MediaSoupState>({
		device: null,
		rtpCapabilities: null,
		producerTransport: null,
		consumerTransport: null,
		producer: null,
		consumers: new Map(),
		isProducer: false,
		localStream: null,
		remoteStreams: new Map(),
	});

	const [isConnected, setIsConnected] = useState(false);
	const [roomName, setRoomName] = useState("");
	const socketRef = useRef<Socket | null>(null);

	const connectToRoom = useCallback(
		async (room: string) => {
			try {
				if (!socketRef.current) {
					socketRef.current = io(serverUrl);
				}

				const socket = socketRef.current;
				setRoomName(room);

				socket.emit("joinRoom", { roomName: room });

				// Get router RTP capabilities
				socket.emit("getRouterRtpCapabilities", (rtpCapabilities: any) => {
					setState((prev) => ({ ...prev, rtpCapabilities }));
					loadDevice(rtpCapabilities);
				});

				socket.on("connect", () => {
					setIsConnected(true);
				});

				socket.on("disconnect", () => {
					setIsConnected(false);
				});

				socket.on("newProducer", ({ producerId }) => {
					signalNewConsumerTransport(producerId);
				});

				socket.on("producerClosed", ({ producerId }) => {
					const consumer = state.consumers.get(producerId);
					if (consumer) {
						consumer.close();
						setState((prev) => {
							const newConsumers = new Map(prev.consumers);
							newConsumers.delete(producerId);
							const newRemoteStreams = new Map(prev.remoteStreams);
							newRemoteStreams.delete(producerId);
							return {
								...prev,
								consumers: newConsumers,
								remoteStreams: newRemoteStreams,
							};
						});
					}
				});
			} catch (error) {
				console.error("Error connecting to room:", error);
			}
		},
		[serverUrl, state.consumers]
	);

	const loadDevice = async (rtpCapabilities: any) => {
		try {
			const device = new Device();
			await device.load({ routerRtpCapabilities: rtpCapabilities });
			setState((prev) => ({ ...prev, device }));
		} catch (error) {
			console.error("Error loading device:", error);
		}
	};

	const createSendTransport = useCallback(async () => {
		if (!socketRef.current || !state.device) return;

		return new Promise<void>((resolve, reject) => {
			socketRef.current!.emit(
				"createWebRtcTransport",
				{ sender: true },
				(params: any) => {
					if (params.error) {
						reject(params.error);
						return;
					}

					const producerTransport = state.device!.createSendTransport(params);

					producerTransport.on(
						"connect",
						async ({ dtlsParameters }, callback, errback) => {
							try {
								socketRef.current!.emit("connectTransport", {
									transportId: producerTransport.id,
									dtlsParameters,
								});
								callback();
							} catch (error: any) {
								errback(error);
							}
						}
					);

					producerTransport.on(
						"produce",
						async (parameters, callback, errback) => {
							try {
								socketRef.current!.emit(
									"produce",
									{
										kind: parameters.kind,
										rtpParameters: parameters.rtpParameters,
										transportId: producerTransport.id,
									},
									(id: any) => {
										callback({ id });
									}
								);
							} catch (error: any) {
								errback(error);
							}
						}
					);

					setState((prev) => ({ ...prev, producerTransport }));
					resolve();
				}
			);
		});
	}, [state.device]);

	const createRecvTransport = useCallback(async () => {
		if (!socketRef.current || !state.device) return;

		return new Promise<void>((resolve, reject) => {
			socketRef.current!.emit(
				"createWebRtcTransport",
				{ sender: false },
				(params: any) => {
					if (params.error) {
						reject(params.error);
						return;
					}

					const consumerTransport = state.device!.createRecvTransport(params);

					consumerTransport.on(
						"connect",
						async ({ dtlsParameters }, callback, errback) => {
							try {
								socketRef.current!.emit("connectTransport", {
									transportId: consumerTransport.id,
									dtlsParameters,
								});
								callback();
							} catch (error: any) {
								errback(error);
							}
						}
					);

					setState((prev) => ({ ...prev, consumerTransport }));
					resolve();
				}
			);
		});
	}, [state.device]);

	const publish = useCallback(
		async (stream: MediaStream) => {
			if (!state.producerTransport) {
				await createSendTransport();
			}

			const track = stream.getVideoTracks()[0];
			if (track && state.producerTransport) {
				const producer = await state.producerTransport.produce({ track });
				setState((prev) => ({
					...prev,
					producer,
					isProducer: true,
					localStream: stream,
				}));
			}
		},
		[state.producerTransport, createSendTransport]
	);

	const signalNewConsumerTransport = useCallback(
		async (producerId: string) => {
			if (!state.consumerTransport) {
				await createRecvTransport();
			}

			if (
				state.consumerTransport &&
				state.rtpCapabilities &&
				socketRef.current
			) {
				socketRef.current.emit(
					"consume",
					{
						producerId,
						rtpCapabilities: state.rtpCapabilities,
					},
					async (params: any) => {
						if (params.error) {
							console.error("Error consuming:", params.error);
							return;
						}

						const consumer = await state.consumerTransport!.consume({
							id: params.id,
							producerId: params.producerId,
							kind: params.kind,
							rtpParameters: params.rtpParameters,
						});

						const stream = new MediaStream();
						stream.addTrack(consumer.track);

						setState((prev) => {
							const newConsumers = new Map(prev.consumers);
							newConsumers.set(consumer.id, consumer);
							const newRemoteStreams = new Map(prev.remoteStreams);
							newRemoteStreams.set(consumer.id, stream);
							return {
								...prev,
								consumers: newConsumers,
								remoteStreams: newRemoteStreams,
							};
						});

						socketRef.current!.emit("resume", { consumerId: consumer.id });
					}
				);
			}
		},
		[state.consumerTransport, state.rtpCapabilities, createRecvTransport]
	);

	const getExistingProducers = useCallback(() => {
		if (!socketRef.current) return;

		socketRef.current.emit("getProducers", (producerIds: string[]) => {
			producerIds.forEach((producerId) => {
				signalNewConsumerTransport(producerId);
			});
		});
	}, [signalNewConsumerTransport]);

	const disconnect = useCallback(() => {
		if (socketRef.current) {
			socketRef.current.disconnect();
			socketRef.current = null;
		}
		setIsConnected(false);
		setState({
			device: null,
			rtpCapabilities: null,
			producerTransport: null,
			consumerTransport: null,
			producer: null,
			consumers: new Map(),
			isProducer: false,
			localStream: null,
			remoteStreams: new Map(),
		});
	}, []);

	useEffect(() => {
		return () => {
			disconnect();
		};
	}, [disconnect]);

	return {
		state,
		isConnected,
		roomName,
		connectToRoom,
		publish,
		getExistingProducers,
		disconnect,
	};
};
