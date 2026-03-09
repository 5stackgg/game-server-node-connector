jest.mock("os", () => ({
  ...jest.requireActual("os"),
  networkInterfaces: jest.fn(),
}));

jest.mock("child_process", () => ({
  spawn: jest.fn().mockReturnValue({
    stdin: { on: jest.fn() },
    stderr: { on: jest.fn() },
    stdout: { on: jest.fn() },
    on: jest.fn(),
    kill: jest.fn(),
  }),
}));

import os from "os";
import { Logger } from "@nestjs/common";
import { NetworkService } from "./network.service";

const mockedNetworkInterfaces = os.networkInterfaces as jest.MockedFunction<
  typeof os.networkInterfaces
>;

function createService() {
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  const service = new NetworkService(logger);

  return { service, logger };
}

describe("NetworkService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────
  // calculateIPv4NetworkAddress
  // ──────────────────────────────────────────────
  describe("calculateIPv4NetworkAddress", () => {
    it("calculates network address for /24", () => {
      const { service } = createService();
      expect(
        service.calculateIPv4NetworkAddress("192.168.1.105", "255.255.255.0"),
      ).toBe("192.168.1.0");
    });

    it("calculates network address for /16", () => {
      const { service } = createService();
      expect(
        service.calculateIPv4NetworkAddress("10.45.67.89", "255.255.0.0"),
      ).toBe("10.45.0.0");
    });

    it("calculates network address for /25 boundary", () => {
      const { service } = createService();
      // 192.168.1.200 & 255.255.255.128 → 192.168.1.128
      expect(
        service.calculateIPv4NetworkAddress(
          "192.168.1.200",
          "255.255.255.128",
        ),
      ).toBe("192.168.1.128");
    });

    it("returns all zeros with a 0.0.0.0 mask", () => {
      const { service } = createService();
      expect(
        service.calculateIPv4NetworkAddress("172.16.5.42", "0.0.0.0"),
      ).toBe("0.0.0.0");
    });

    it("returns the IP itself with a 255.255.255.255 mask", () => {
      const { service } = createService();
      expect(
        service.calculateIPv4NetworkAddress(
          "172.16.5.42",
          "255.255.255.255",
        ),
      ).toBe("172.16.5.42");
    });
  });

  // ──────────────────────────────────────────────
  // calculateIPv6NetworkAddress (also exercises expandIPv6)
  // ──────────────────────────────────────────────
  describe("calculateIPv6NetworkAddress", () => {
    it("calculates network address for /64 prefix", () => {
      const { service } = createService();
      const result = service.calculateIPv6NetworkAddress(
        "2001:0db8:85a3:0000:1234:5678:9abc:def0",
        "2001:0db8:85a3:0000:1234:5678:9abc:def0/64",
      );
      expect(result).toBe("2001:0db8:85a3:0000:0000:0000:0000:0000");
    });

    it("calculates network address for /48 prefix", () => {
      const { service } = createService();
      const result = service.calculateIPv6NetworkAddress(
        "2001:0db8:abcd:1234:5678:9abc:def0:1234",
        "2001:0db8:abcd:1234:5678:9abc:def0:1234/48",
      );
      expect(result).toBe("2001:0db8:abcd:0000:0000:0000:0000:0000");
    });

    it("calculates network address for /56 prefix (partial segment mask)", () => {
      const { service } = createService();
      // /56 means 3 full segments (48 bits) + 8 bits in 4th segment
      // 4th segment: 0x1234 & mask(0xff00) = 0x1200
      const result = service.calculateIPv6NetworkAddress(
        "2001:0db8:abcd:1234:5678:9abc:def0:0001",
        "2001:0db8:abcd:1234:5678:9abc:def0:0001/56",
      );
      expect(result).toBe("2001:0db8:abcd:1200:0000:0000:0000:0000");
    });

    it("handles ::1 (loopback) via expansion", () => {
      const { service } = createService();
      const result = service.calculateIPv6NetworkAddress(
        "::1",
        "::1/128",
      );
      expect(result).toBe("0000:0000:0000:0000:0000:0000:0000:0001");
    });

    it("handles 2001:db8:: via expansion with /32 prefix", () => {
      const { service } = createService();
      const result = service.calculateIPv6NetworkAddress(
        "2001:db8::",
        "2001:db8::/32",
      );
      expect(result).toBe("2001:0db8:0000:0000:0000:0000:0000:0000");
    });

    it("handles fe80::1 via expansion with /10 prefix", () => {
      const { service } = createService();
      // fe80 = 0xfe80; /10 means first 10 bits → mask 0xffc0 → 0xfe80 & 0xffc0 = 0xfe80
      const result = service.calculateIPv6NetworkAddress(
        "fe80::1",
        "fe80::1/10",
      );
      expect(result).toBe("fe80:0000:0000:0000:0000:0000:0000:0000");
    });
  });

  // ──────────────────────────────────────────────
  // getNetworkStats
  // ──────────────────────────────────────────────
  describe("getNetworkStats", () => {
    it("returns empty array when capturedNics is empty", () => {
      const { service } = createService();
      expect(service.getNetworkStats()).toEqual([]);
    });

    it("returns averaged stats for a single NIC", () => {
      const { service } = createService();
      const capturedNics = (service as any).capturedNics as Map<
        string,
        { tx: Map<string, number>; rx: Map<string, number> }
      >;

      const tx = new Map<string, number>();
      tx.set("t1", 100);
      tx.set("t2", 200);

      const rx = new Map<string, number>();
      rx.set("t1", 400);
      rx.set("t2", 600);

      capturedNics.set("eth0", { tx, rx });

      const stats = service.getNetworkStats();
      expect(stats).toEqual([
        { name: "eth0", tx: 150, rx: 500 },
      ]);
    });

    it("returns stats for multiple NICs", () => {
      const { service } = createService();
      const capturedNics = (service as any).capturedNics as Map<
        string,
        { tx: Map<string, number>; rx: Map<string, number> }
      >;

      const tx1 = new Map<string, number>([["t1", 1000]]);
      const rx1 = new Map<string, number>([["t1", 2000]]);
      capturedNics.set("eth0", { tx: tx1, rx: rx1 });

      const tx2 = new Map<string, number>([["t1", 500]]);
      const rx2 = new Map<string, number>([["t1", 750]]);
      capturedNics.set("eth1", { tx: tx2, rx: rx2 });

      const stats = service.getNetworkStats();
      expect(stats).toHaveLength(2);
      expect(stats).toEqual(
        expect.arrayContaining([
          { name: "eth0", tx: 1000, rx: 2000 },
          { name: "eth1", tx: 500, rx: 750 },
        ]),
      );
    });

    it("clears tx and rx maps after reading", () => {
      const { service } = createService();
      const capturedNics = (service as any).capturedNics as Map<
        string,
        { tx: Map<string, number>; rx: Map<string, number> }
      >;

      const tx = new Map<string, number>([["t1", 100]]);
      const rx = new Map<string, number>([["t1", 200]]);
      capturedNics.set("eth0", { tx, rx });

      service.getNetworkStats();

      expect(tx.size).toBe(0);
      expect(rx.size).toBe(0);
    });

    it("returns zero averages when tx/rx maps are empty", () => {
      const { service } = createService();
      const capturedNics = (service as any).capturedNics as Map<
        string,
        { tx: Map<string, number>; rx: Map<string, number> }
      >;

      capturedNics.set("eth0", {
        tx: new Map<string, number>(),
        rx: new Map<string, number>(),
      });

      const stats = service.getNetworkStats();
      expect(stats).toEqual([{ name: "eth0", tx: 0, rx: 0 }]);
    });
  });

  // ──────────────────────────────────────────────
  // captureData (private — accessed via bracket notation)
  // ──────────────────────────────────────────────
  describe("captureData", () => {
    it("parses a valid line like '9709 B/s old=… now=…'", () => {
      const { service } = createService();
      const result = (service as any).captureData(
        "9709 B/s old=83628110721 now=83628120430",
      );
      expect(result).toBe(9709);
    });

    it("returns 0 for malformed input", () => {
      const { service, logger } = createService();
      const result = (service as any).captureData("not a valid line");
      expect(result).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("parses zero bytes per second", () => {
      const { service } = createService();
      const result = (service as any).captureData(
        "0 B/s old=100 now=100",
      );
      expect(result).toBe(0);
    });
  });

  // ──────────────────────────────────────────────
  // getNetworkLimit / setNetworkLimit
  // ──────────────────────────────────────────────
  describe("getNetworkLimit / setNetworkLimit", () => {
    it("returns undefined before any limit is set", async () => {
      const { service } = createService();
      expect(await service.getNetworkLimit()).toBeUndefined();
    });

    it("sets and gets a network limit", async () => {
      const { service } = createService();
      await service.setNetworkLimit(100);
      expect(await service.getNetworkLimit()).toBe(100);
    });

    it("logs when setting a new limit", async () => {
      const { service, logger } = createService();
      await service.setNetworkLimit(50);
      expect(logger.log).toHaveBeenCalledWith(
        "Demo Upload is network limited to 50 Mbps",
      );
    });

    it("does not log when setting the same limit again", async () => {
      const { service, logger } = createService();
      await service.setNetworkLimit(50);
      (logger.log as jest.Mock).mockClear();

      await service.setNetworkLimit(50);
      expect(logger.log).not.toHaveBeenCalled();
    });

    it("allows clearing the limit to undefined", async () => {
      const { service } = createService();
      await service.setNetworkLimit(100);
      await service.setNetworkLimit(undefined);
      expect(await service.getNetworkLimit()).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────
  // getLanInterface / getLanIP
  // ──────────────────────────────────────────────
  describe("getLanInterface / getLanIP", () => {
    it("returns IPv4 and IPv6 from mocked interfaces", () => {
      const { service } = createService();
      mockedNetworkInterfaces.mockReturnValue({
        eth0: [
          {
            address: "192.168.1.50",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            cidr: "192.168.1.50/24",
          },
          {
            address: "fe80::1",
            netmask: "ffff:ffff:ffff:ffff::",
            family: "IPv6",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            cidr: "fe80::1/64",
            scopeid: 1,
          },
        ],
      });

      const iface = service.getLanInterface();
      expect(iface.ipv4).not.toBeNull();
      expect(iface.ipv4!.address).toBe("192.168.1.50");
      expect(iface.ipv4!.subnet).toBe("192.168.1.0");
      expect(iface.ipv6).not.toBeNull();
      expect(iface.ipv6!.address).toBe("fe80::1");
    });

    it("getLanIP returns the IPv4 address", () => {
      const { service } = createService();
      mockedNetworkInterfaces.mockReturnValue({
        eth0: [
          {
            address: "10.0.0.5",
            netmask: "255.255.0.0",
            family: "IPv4",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            cidr: "10.0.0.5/16",
          },
        ],
      });

      expect(service.getLanIP()).toBe("10.0.0.5");
    });

    it("skips tailscale interfaces", () => {
      const { service } = createService();
      mockedNetworkInterfaces.mockReturnValue({
        tailscale0: [
          {
            address: "100.100.100.1",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "00:00:00:00:00:00",
            internal: false,
            cidr: "100.100.100.1/24",
          },
        ],
      });

      const iface = service.getLanInterface();
      expect(iface.ipv4).toBeNull();
      expect(iface.ipv6).toBeNull();
    });

    it("skips internal (loopback) interfaces", () => {
      const { service } = createService();
      mockedNetworkInterfaces.mockReturnValue({
        lo: [
          {
            address: "127.0.0.1",
            netmask: "255.0.0.0",
            family: "IPv4",
            mac: "00:00:00:00:00:00",
            internal: true,
            cidr: "127.0.0.1/8",
          },
        ],
      });

      const iface = service.getLanInterface();
      expect(iface.ipv4).toBeNull();
    });

    it("returns null for both when no matching interfaces exist", () => {
      const { service } = createService();
      mockedNetworkInterfaces.mockReturnValue({});

      const iface = service.getLanInterface();
      expect(iface.ipv4).toBeNull();
      expect(iface.ipv6).toBeNull();
    });

    it("getLanIP returns undefined when no IPv4 interface exists", () => {
      const { service } = createService();
      mockedNetworkInterfaces.mockReturnValue({});

      expect(service.getLanIP()).toBeUndefined();
    });

    it("skips cni interfaces", () => {
      const { service } = createService();
      mockedNetworkInterfaces.mockReturnValue({
        cni0: [
          {
            address: "10.244.0.1",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            cidr: "10.244.0.1/24",
          },
        ],
      });

      const iface = service.getLanInterface();
      expect(iface.ipv4).toBeNull();
    });
  });
});
