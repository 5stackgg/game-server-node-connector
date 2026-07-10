import { Redis } from "ioredis";
import { ConfigService } from "@nestjs/config";
import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { WebRtcConfig } from "src/configs/types/WebRtcConfig";
import nodeDataChannel, { PeerConnection } from "node-datachannel";
import { RedisManagerService } from "src/redis/redis-manager/redis-manager.service";
import { ClientProxy } from "@nestjs/microservices";
import { NetworkService } from "src/system/network.service";

@Injectable()
export class WebrtcService implements OnModuleDestroy {
  private redis: Redis;
  private pcMap = new Map<string, PeerConnection>();
  // Connections already closed, so a deferred "closed" state change from a
  // connection that was replaced by a re-offer does not close it a second time.
  private closedConnections = new WeakSet<PeerConnection>();

  constructor(
    private readonly configService: ConfigService,
    private readonly redisManagerService: RedisManagerService,
    private readonly networkService: NetworkService,
    private readonly logger: Logger,
    @Inject("API_SERVICE") private client: ClientProxy,
  ) {
    this.redis = this.redisManagerService.getConnection();
    nodeDataChannel.initLogger(
      this.configService.get<WebRtcConfig>("webrtc")!.logLevel,
    );
  }

  // Close a specific PeerConnection and drop it from the map only if the map
  // still points at it. The instance matters: a re-offer replaces the map entry
  // under the same peerId, and node-datachannel delivers the previous
  // connection's "closed" state change on a LATER tick, so a key-only lookup
  // would tear down the new connection. Called with no `connection` (dedupe /
  // shutdown) it targets whatever currently holds the key.
  private closePeerConnection(peerId: string, connection?: PeerConnection) {
    const target = connection ?? this.pcMap.get(peerId);
    if (!target) {
      return;
    }
    // Only evict the map entry if it is still this instance; a newer connection
    // may already have taken the key.
    if (this.pcMap.get(peerId) === target) {
      this.pcMap.delete(peerId);
    }
    if (this.closedConnections.has(target)) {
      return;
    }
    this.closedConnections.add(target);
    try {
      target.close();
    } catch (error) {
      this.logger.warn(`Failed to close peer connection ${peerId}`, error);
    }
  }

  public onModuleDestroy() {
    for (const [peerId, connection] of [...this.pcMap.entries()]) {
      this.closePeerConnection(peerId, connection);
    }
  }

  public createPeerConnection(
    clientId: string,
    peerId: string,
    sessionId: string,
    region: string,
  ) {
    // A re-offer for the same peer must not orphan the previous native
    // connection (node-datachannel needs an explicit close to free resources).
    this.closePeerConnection(peerId);

    const peerConnection = new nodeDataChannel.PeerConnection(peerId, {
      iceServers: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
        "stun:stun3.l.google.com:19302",
        "stun:stun4.l.google.com:19302",
      ],
    });

    // The latency test is short-lived; once the connection ends (or fails to
    // establish) free the native resources and the map entry so they do not
    // accumulate across every region test a client runs.
    peerConnection.onStateChange((state) => {
      if (state === "disconnected" || state === "failed" || state === "closed") {
        // Close THIS connection specifically, not whatever currently holds the
        // key (a re-offer may already have replaced it).
        this.closePeerConnection(peerId, peerConnection);
      }
    });

    peerConnection.onLocalDescription((description, type) => {
      this.client.emit(type, {
        peerId,
        clientId,
        type,
        signal: {
          type,
          sdp: description,
        },
      });
    });

    peerConnection.onLocalCandidate((candidate, sdpMid) => {
      this.client.emit("candidate", {
        peerId,
        clientId,
        type: "candidate",
        signal: {
          type: "candidate",
          candidate: {
            sdpMid: sdpMid,
            candidate: candidate,
          },
        },
      });
    });

    peerConnection.onDataChannel((datachannel) => {
      let startTime: number;
      let latencyArray: number[];

      datachannel.onMessage(async (data) => {
        switch (data) {
          case "latency-test":
            latencyArray = [];
            datachannel.sendMessage("");
            startTime = performance.now();
            break;
          default:
            const endTime = performance.now();
            const latency = endTime - startTime;

            latencyArray.push(latency);
            if (latencyArray.length < 4) {
              datachannel.sendMessage("");
              startTime = performance.now();
              return;
            }
            const avgLatency =
              latencyArray.reduce((a, b) => a + b, 0) / latencyArray.length;

            const results = {
              region,
              latency: avgLatency,
              isLan: this.isSameLAN(peerConnection),
            };

            const latencyTestKey = `latency-test:${sessionId}`;

            try {
              await this.redis
                .multi()
                .hset(
                  latencyTestKey,
                  region.toLowerCase().replace(" ", "_"),
                  JSON.stringify(results),
                )
                .expire(latencyTestKey, 60 * 60)
                .exec();
            } catch (error) {
              this.logger.error(
                `Failed to store latency results for session ${sessionId}`,
                error,
              );
            }

            datachannel.sendMessage(
              JSON.stringify({
                type: "latency-results",
                data: results,
              }),
            );
            break;
        }
      });
    });

    this.pcMap.set(peerId, peerConnection);

    return peerConnection;
  }

  public isSameLAN(peerConnection: PeerConnection) {
    const pair = peerConnection.getSelectedCandidatePair();
    if (!pair) {
      return false;
    }

    const localInterface = this.networkService.getLanInterface();

    const localAddress = pair.local.address;
    const remoteAddress = pair.remote.address;

    if (localAddress.includes(".") && remoteAddress.includes(".")) {
      if (!localInterface.ipv4) {
        return false;
      }

      const localNetwork = this.networkService.calculateIPv4NetworkAddress(
        localAddress,
        localInterface.ipv4.netmask,
      );
      const remoteNetwork = this.networkService.calculateIPv4NetworkAddress(
        remoteAddress,
        localInterface.ipv4.netmask,
      );

      return localNetwork === remoteNetwork;
    }

    if (localAddress.includes(":") && remoteAddress.includes(":")) {
      if (!localInterface.ipv6 || !localInterface.ipv6.cidr) {
        return false;
      }

      const localNetwork = this.networkService.calculateIPv6NetworkAddress(
        localAddress,
        localInterface.ipv6.cidr,
      );
      const remoteNetwork = this.networkService.calculateIPv6NetworkAddress(
        remoteAddress,
        localInterface.ipv6.cidr,
      );

      return localNetwork === remoteNetwork;
    }

    return false;
  }

  public handleOffer(data: any) {
    if (!data.clientId || !data.peerId || !data.sessionId || !data.region) {
      this.logger.error("invalid offer", {
        clientId: data.clientId,
        peerId: data.peerId,
        sessionId: data.sessionId,
        region: data.region,
      });
      return;
    }

    const pc = this.createPeerConnection(
      data.clientId,
      data.peerId,
      data.sessionId,
      data.region,
    );
    pc.setRemoteDescription(data.signal.sdp, data.signal.type);
  }

  public handleCandidate(data: any) {
    this.pcMap
      .get(data.peerId)
      ?.addRemoteCandidate(
        data.signal.candidate.candidate,
        data.signal.candidate.sdpMid,
      );
  }
}
