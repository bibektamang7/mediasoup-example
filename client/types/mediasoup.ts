import { Device } from "mediasoup-client";
import {
	Transport,
	Producer,
	Consumer,
	RtpCapabilities,
} from "mediasoup-client/lib/types";
import { MediaKind, RtpParameters } from "mediasoup-client/lib/RtpParameters";

export interface SocketEvents {
	connection: () => void;
	connect: () => void;
	disconnect: () => void;
	joinRoom: (data: { roomName: string }) => void;
	getRouterRtpCapabilities: (
		callback: (rtpCapabilities: RtpCapabilities) => void
	) => void;
	createWebRtcTransport: (
		data: { sender: boolean },
		callback: (params: any) => void
	) => void;
	connectTransport: (data: {
		transportId: string;
		dtlsParameters: any;
	}) => void;
	produce: (
		data: {
			kind: MediaKind;
			rtpParameters: RtpParameters;
			transportId: string;
		},
		callback: (id: string) => void
	) => void;
	consume: (
		data: { producerId: string; rtpCapabilities: RtpCapabilities },
		callback: (params: any) => void
	) => void;
	resume: (data: { consumerId: string }) => void;
	getProducers: (callback: (producerIds: string[]) => void) => void;
	producerClosed: (data: { producerId: string }) => void;
	newProducer: (data: { producerId: string }) => void;
}

export interface MediaSoupState {
	device: Device | null;
	rtpCapabilities: RtpCapabilities | null;
	producerTransport: Transport | null;
	consumerTransport: Transport | null;
	producer: Producer | null;
	consumers: Map<string, Consumer>;
	isProducer: boolean;
	localStream: MediaStream | null;
	remoteStreams: Map<string, MediaStream>;
}
