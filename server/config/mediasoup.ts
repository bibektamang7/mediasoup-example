// config/mediasoup.ts
import { RtpCodecCapability } from 'mediasoup/node/lib/types';
import { MediaSoupConfig } from '../types/server';

export const config: MediaSoupConfig = {
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp',
      'rtx',
      'bwe',
      'score',
      'simulcast',
      'svc'
    ]
  },
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000
        }
      },
      // {
      //   kind: 'video',
      //   mimeType: 'video/VP9',
      //   clockRate: 90000,
      //   parameters: {
      //     'profile-id': 2,
      //     'x-google-start-bitrate': 1000
      //   }
      // },
      // {
      //   kind: 'video',
      //   mimeType: 'video/h264',
      //   clockRate: 90000,
      //   parameters: {
      //     'packetization-mode': 1,
      //     'profile-level-id': '4d0032',
      //     'level-asymmetry-allowed': 1,
      //     'x-google-start-bitrate': 1000
      //   }
      // },
      // {
      //   kind: 'video',
      //   mimeType: 'video/h264',
      //   clockRate: 90000,
      //   parameters: {
      //     'packetization-mode': 1,
      //     'profile-level-id': '42e01f',
      //     'level-asymmetry-allowed': 1,
      //     'x-google-start-bitrate': 1000
      //   }
      // }
    ] as RtpCodecCapability[]
  },
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: '127.0.0.1' // Replace with your server's public IP
      }
    ],
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000
  }
};