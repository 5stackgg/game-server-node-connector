jest.mock("node-datachannel", () => ({
  __esModule: true,
  default: {
    initLogger: jest.fn(),
    PeerConnection: jest.fn().mockImplementation(() => ({
      onLocalDescription: jest.fn(),
      onLocalCandidate: jest.fn(),
      onDataChannel: jest.fn(),
      setRemoteDescription: jest.fn(),
      addRemoteCandidate: jest.fn(),
      getSelectedCandidatePair: jest.fn(),
    })),
  },
  PeerConnection: jest.fn(),
}));

import { WebrtcService } from "./webrtc.service";

function createService() {
  const configService = {
    get: jest.fn().mockReturnValue({ logLevel: "none" }),
  };
  const redisConnection = {};
  const redisManagerService = {
    getConnection: jest.fn().mockReturnValue(redisConnection),
  };
  const networkService = {
    getLanInterface: jest.fn(),
    calculateIPv4NetworkAddress: jest.fn(),
    calculateIPv6NetworkAddress: jest.fn(),
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any;
  const client = { emit: jest.fn() };

  const service = new WebrtcService(
    configService as any,
    redisManagerService as any,
    networkService as any,
    logger,
    client as any,
  );

  return {
    service,
    configService,
    redisManagerService,
    networkService,
    logger,
    client,
  };
}

describe("WebrtcService", () => {
  describe("isSameLAN", () => {
    it("returns true for IPv4 addresses on same subnet", () => {
      const { service, networkService } = createService();

      networkService.getLanInterface.mockReturnValue({
        ipv4: { netmask: "255.255.255.0" },
      });
      networkService.calculateIPv4NetworkAddress
        .mockReturnValueOnce("192.168.1.0")
        .mockReturnValueOnce("192.168.1.0");

      const mockPc = {
        getSelectedCandidatePair: jest.fn().mockReturnValue({
          local: { address: "192.168.1.10" },
          remote: { address: "192.168.1.20" },
        }),
      } as any;

      expect(service.isSameLAN(mockPc)).toBe(true);
    });

    it("returns false for IPv4 addresses on different subnets", () => {
      const { service, networkService } = createService();

      networkService.getLanInterface.mockReturnValue({
        ipv4: { netmask: "255.255.255.0" },
      });
      networkService.calculateIPv4NetworkAddress
        .mockReturnValueOnce("192.168.1.0")
        .mockReturnValueOnce("10.0.0.0");

      const mockPc = {
        getSelectedCandidatePair: jest.fn().mockReturnValue({
          local: { address: "192.168.1.10" },
          remote: { address: "10.0.0.5" },
        }),
      } as any;

      expect(service.isSameLAN(mockPc)).toBe(false);
    });

    it("returns true for IPv6 addresses with same prefix", () => {
      const { service, networkService } = createService();

      networkService.getLanInterface.mockReturnValue({
        ipv6: { cidr: 64 },
      });
      networkService.calculateIPv6NetworkAddress
        .mockReturnValueOnce("fe80::")
        .mockReturnValueOnce("fe80::");

      const mockPc = {
        getSelectedCandidatePair: jest.fn().mockReturnValue({
          local: { address: "fe80::1" },
          remote: { address: "fe80::2" },
        }),
      } as any;

      expect(service.isSameLAN(mockPc)).toBe(true);
    });

    it("returns false for IPv6 addresses with different prefixes", () => {
      const { service, networkService } = createService();

      networkService.getLanInterface.mockReturnValue({
        ipv6: { cidr: 64 },
      });
      networkService.calculateIPv6NetworkAddress
        .mockReturnValueOnce("fe80::")
        .mockReturnValueOnce("2001:db8::");

      const mockPc = {
        getSelectedCandidatePair: jest.fn().mockReturnValue({
          local: { address: "fe80::1" },
          remote: { address: "2001:db8::1" },
        }),
      } as any;

      expect(service.isSameLAN(mockPc)).toBe(false);
    });

    it("returns false when no candidate pair is available", () => {
      const { service } = createService();

      const mockPc = {
        getSelectedCandidatePair: jest.fn().mockReturnValue(null),
      } as any;

      expect(service.isSameLAN(mockPc)).toBe(false);
    });

    it("returns false when ipv4 interface is missing for dot addresses", () => {
      const { service, networkService } = createService();

      networkService.getLanInterface.mockReturnValue({});

      const mockPc = {
        getSelectedCandidatePair: jest.fn().mockReturnValue({
          local: { address: "192.168.1.10" },
          remote: { address: "192.168.1.20" },
        }),
      } as any;

      expect(service.isSameLAN(mockPc)).toBe(false);
    });

    it("returns false for mixed IPv4 and IPv6 addresses", () => {
      const { service, networkService } = createService();

      networkService.getLanInterface.mockReturnValue({
        ipv4: { netmask: "255.255.255.0" },
        ipv6: { cidr: 64 },
      });

      const mockPc = {
        getSelectedCandidatePair: jest.fn().mockReturnValue({
          local: { address: "192.168.1.10" },
          remote: { address: "fe80::1" },
        }),
      } as any;

      expect(service.isSameLAN(mockPc)).toBe(false);
    });
  });

  describe("handleOffer", () => {
    it("creates peer connection and sets remote description with valid data", () => {
      const { service } = createService();
      const nodeDataChannel =
        jest.requireMock("node-datachannel").default;

      service.handleOffer({
        clientId: "client-1",
        peerId: "peer-1",
        sessionId: "session-1",
        region: "US East",
        signal: { sdp: "v=0...", type: "offer" },
      });

      expect(nodeDataChannel.PeerConnection).toHaveBeenCalledWith(
        "peer-1",
        expect.any(Object),
      );

      const mockPcInstance = nodeDataChannel.PeerConnection.mock.results[0].value;
      expect(mockPcInstance.setRemoteDescription).toHaveBeenCalledWith(
        "v=0...",
        "offer",
      );
    });

    it("returns early on missing clientId", () => {
      const { service, logger } = createService();
      const nodeDataChannel =
        jest.requireMock("node-datachannel").default;

      nodeDataChannel.PeerConnection.mockClear();

      service.handleOffer({
        peerId: "peer-1",
        sessionId: "session-1",
        region: "US East",
        signal: { sdp: "v=0...", type: "offer" },
      });

      expect(logger.error).toHaveBeenCalledWith("invalid offer", expect.any(Object));
      expect(nodeDataChannel.PeerConnection).not.toHaveBeenCalled();
    });

    it("returns early on missing peerId", () => {
      const { service, logger } = createService();
      const nodeDataChannel =
        jest.requireMock("node-datachannel").default;

      nodeDataChannel.PeerConnection.mockClear();

      service.handleOffer({
        clientId: "client-1",
        sessionId: "session-1",
        region: "US East",
        signal: { sdp: "v=0...", type: "offer" },
      });

      expect(logger.error).toHaveBeenCalledWith("invalid offer", expect.any(Object));
      expect(nodeDataChannel.PeerConnection).not.toHaveBeenCalled();
    });

    it("returns early on missing sessionId", () => {
      const { service, logger } = createService();
      const nodeDataChannel =
        jest.requireMock("node-datachannel").default;

      nodeDataChannel.PeerConnection.mockClear();

      service.handleOffer({
        clientId: "client-1",
        peerId: "peer-1",
        region: "US East",
        signal: { sdp: "v=0...", type: "offer" },
      });

      expect(logger.error).toHaveBeenCalledWith("invalid offer", expect.any(Object));
      expect(nodeDataChannel.PeerConnection).not.toHaveBeenCalled();
    });
  });

  describe("handleCandidate", () => {
    it("forwards candidate to peer connection", () => {
      const { service } = createService();
      const nodeDataChannel =
        jest.requireMock("node-datachannel").default;

      service.handleOffer({
        clientId: "client-1",
        peerId: "peer-1",
        sessionId: "session-1",
        region: "US East",
        signal: { sdp: "v=0...", type: "offer" },
      });

      const mockPcInstance = nodeDataChannel.PeerConnection.mock.results[0].value;

      service.handleCandidate({
        peerId: "peer-1",
        signal: {
          candidate: {
            candidate: "candidate:123 1 udp ...",
            sdpMid: "0",
          },
        },
      });

      expect(mockPcInstance.addRemoteCandidate).toHaveBeenCalledWith(
        "candidate:123 1 udp ...",
        "0",
      );
    });

    it("does not throw for unknown peerId", () => {
      const { service } = createService();

      expect(() => {
        service.handleCandidate({
          peerId: "unknown-peer",
          signal: {
            candidate: {
              candidate: "candidate:123 1 udp ...",
              sdpMid: "0",
            },
          },
        });
      }).not.toThrow();
    });
  });
});
