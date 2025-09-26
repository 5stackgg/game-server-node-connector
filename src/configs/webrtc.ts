import { WebRtcConfig } from "./types/WebRtcConfig";
import { LogLevel } from "node-datachannel";

export default (): {
  webrtc: WebRtcConfig;
} => ({
  webrtc: {
    logLevel: process.env.WEBRTC_LOG_LEVEL
      ? (process.env.WEBRTC_LOG_LEVEL as LogLevel)
      : "Error",
  },
});
