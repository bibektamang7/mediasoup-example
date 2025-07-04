// types/server.ts
import { Worker, Router, WebRtcTransport, Producer, Consumer } from 'mediasoup/node/lib/types';
import { Socket } from 'socket.io';
import { Peer } from '../lib/Peer';

export interface Room {
  id: string;
  router: Router;
  peers: Map<string, Peer>;
}



export interface MediaSoupConfig {
  worker: {
    rtcMinPort: number;
    rtcMaxPort: number;
    logLevel: 'debug' | 'warn' | 'error';
    logTags: string[];
  };
  router: {
    mediaCodecs: any[];
  };
  webRtcTransport: {
    listenIps: Array<{
      ip: string;
      announcedIp?: string;
    }>;
    maxIncomingBitrate: number;
    initialAvailableOutgoingBitrate: number;
  };
}
