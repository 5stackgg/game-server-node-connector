import os from "os";
import { spawn } from "child_process";
import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";

@Injectable()
export class NetworkService implements OnApplicationBootstrap {
  public publicIP: string;
  public networkLimit?: number;

  constructor(private readonly logger: Logger) {}

  public async getNetworkLimit() {
    return this.networkLimit;
  }

  public async setNetworkLimit(limit?: number) {
    if (this.networkLimit === limit) {
      return;
    }
    this.logger.log(`Demo Upload is network limited to ${limit} Mbps`);
    this.networkLimit = limit;
  }

  public async onApplicationBootstrap() {
    await this.getPublicIP();

    setInterval(
      async () => {
        await this.getPublicIP();
      },
      5 * 60 * 1000,
    );
  }

  public async getLanIP() {
    return this.getLanInterface().ipv4?.address;
  }

  public getLanInterface() {
    const interfaces = this.getInterfaces();
    const ipv4Interface = interfaces.find(
      (iface) =>
        !iface.name.startsWith("tailscale") &&
        iface.family === "IPv4" &&
        iface.netmask,
    );

    const ipv6Interface = interfaces.find(
      (iface) =>
        !iface.name.startsWith("tailscale") &&
        iface.family === "IPv6" &&
        iface.cidr,
    );

    return {
      ipv4: ipv4Interface
        ? {
            ...ipv4Interface,
            subnet: this.calculateSubnet(
              ipv4Interface.address,
              ipv4Interface.netmask,
            ),
          }
        : null,
      ipv6:
        ipv6Interface && ipv6Interface.cidr
          ? {
              ...ipv6Interface,
              subnet: this.calculateIPv6Subnet(
                ipv6Interface.address,
                ipv6Interface.cidr,
              ),
            }
          : null,
    };
  }

  private calculateSubnet(ip: string, netmask: string): string {
    const ipOctets = ip.split(".").map((octet) => parseInt(octet, 10));
    const netmaskOctets = netmask
      .split(".")
      .map((octet) => parseInt(octet, 10));

    const networkOctets = ipOctets.map(
      (octet, index) => octet & netmaskOctets[index],
    );

    return networkOctets.join(".");
  }

  private calculateIPv6Subnet(ip: string, cidr: string): string {
    // Extract prefix length from CIDR (e.g., "2001:db8::/64" -> 64)
    const prefixLength = parseInt(cidr.split("/")[1], 10);

    // Expand IPv6 address to full form
    const expanded = this.expandIPv6(ip);
    const segments = expanded
      .split(":")
      .map((segment) => parseInt(segment, 16));

    // Calculate how many segments to keep based on prefix length
    const segmentsToKeep = Math.floor(prefixLength / 16);
    const bitsInLastSegment = prefixLength % 16;

    // Create the network address
    const networkSegments = segments.map((segment, index) => {
      if (index < segmentsToKeep) {
        return segment; // Keep full segments
      } else if (index === segmentsToKeep && bitsInLastSegment > 0) {
        // Mask the last partial segment
        const mask = (0xffff << (16 - bitsInLastSegment)) & 0xffff;
        return segment & mask;
      } else {
        return 0; // Zero out remaining segments
      }
    });

    return networkSegments
      .map((segment) => segment.toString(16).padStart(4, "0"))
      .join(":");
  }

  private expandIPv6(ip: string): string {
    if (ip.includes("::")) {
      const parts = ip.split("::");
      const leftParts = parts[0] ? parts[0].split(":") : [];
      const rightParts = parts[1] ? parts[1].split(":") : [];
      const missingParts = 8 - leftParts.length - rightParts.length;
      const zeros = Array(missingParts).fill("0");
      return [...leftParts, ...zeros, ...rightParts].join(":");
    }
    return ip;
  }

  public calculateIPv4NetworkAddress(ip: string, netmask: string): string {
    const ipOctets = ip.split(".").map((octet) => parseInt(octet, 10));
    const netmaskOctets = netmask
      .split(".")
      .map((octet) => parseInt(octet, 10));

    const networkOctets = ipOctets.map(
      (octet, index) => octet & netmaskOctets[index],
    );

    return networkOctets.join(".");
  }

  public calculateIPv6NetworkAddress(ip: string, cidr: string): string {
    // Extract prefix length from CIDR (e.g., "2001:db8::/64" -> 64)
    const prefixLength = parseInt(cidr.split("/")[1], 10);

    // Expand IPv6 address to full form
    const expanded = this.expandIPv6(ip);
    const segments = expanded
      .split(":")
      .map((segment) => parseInt(segment, 16));

    // Calculate how many segments to keep based on prefix length
    const segmentsToKeep = Math.floor(prefixLength / 16);
    const bitsInLastSegment = prefixLength % 16;

    // Create the network address
    const networkSegments = segments.map((segment, index) => {
      if (index < segmentsToKeep) {
        return segment; // Keep full segments
      } else if (index === segmentsToKeep && bitsInLastSegment > 0) {
        // Mask the last partial segment
        const mask = (0xffff << (16 - bitsInLastSegment)) & 0xffff;
        return segment & mask;
      } else {
        return 0; // Zero out remaining segments
      }
    });

    return networkSegments
      .map((segment) => segment.toString(16).padStart(4, "0"))
      .join(":");
  }

  public async getPublicIP() {
    try {
      const response = await fetch("https://checkip.amazonaws.com");
      this.publicIP = (await response.text()).replace(/\n/, "");
    } catch (error) {
      this.logger.warn("unable to get ipv4 address", error);
    }
  }

  public getNetworkStats() {
    const nics: Array<{ name: string; tx: number; rx: number }> = [];

    for (const [nic, nicStats] of this.capturedNics.entries()) {
      const txValues = Array.from(nicStats.tx.values());
      const rxValues = Array.from(nicStats.rx.values());

      const txAvg =
        txValues.length > 0
          ? txValues.reduce((a, b) => a + b, 0) / txValues.length
          : 0;
      const rxAvg =
        rxValues.length > 0
          ? rxValues.reduce((a, b) => a + b, 0) / rxValues.length
          : 0;

      nics.push({
        name: nic,
        tx: Math.ceil(txAvg),
        rx: Math.ceil(rxAvg),
      });

      nicStats.tx.clear();
      nicStats.rx.clear();
    }

    return nics;
  }

  private getInterfaces(): Array<
    (os.NetworkInterfaceInfoIPv4 | os.NetworkInterfaceInfoIPv6) & {
      name: string;
    }
  > {
    const interfaces: Array<
      (os.NetworkInterfaceInfoIPv4 | os.NetworkInterfaceInfoIPv6) & {
        name: string;
      }
    > = [];
    const _interfaces = os.networkInterfaces();
    for (const name of Object.keys(_interfaces)) {
      const ifaces = _interfaces[name];

      if (!ifaces) {
        continue;
      }

      for (const iface of ifaces) {
        if (iface.internal || name.startsWith("cni")) {
          continue;
        }

        interfaces.push({ ...iface, name });
      }
    }

    for (const iface of interfaces) {
      if (iface.family !== "IPv4") {
        continue;
      }
      this.captureNicStats(iface.name);
    }

    return interfaces;
  }

  private capturedNics = new Map<
    string,
    {
      tx: Map<string, number>;
      rx: Map<string, number>;
    }
  >();

  private async captureNicStats(nic: string) {
    if (this.capturedNics.has(nic)) {
      return;
    }

    this.logger.log(`Capturing nic stats for ${nic}`);

    const nicStats = {
      tx: new Map<string, number>(),
      rx: new Map<string, number>(),
    };

    this.capturedNics.set(nic, nicStats);

    this.capture(nic, "tx", (data) => {
      const tx = this.captureData(data);
      if (!tx) {
        return;
      }
      nicStats.tx.set(new Date().toISOString(), tx);
    });
    this.capture(nic, "rx", (data) => {
      const rx = this.captureData(data);
      if (!rx) {
        return;
      }
      nicStats.rx.set(new Date().toISOString(), rx);
    });
  }

  private capture(
    nic: string,
    type: "tx" | "rx",
    onData: (data: string) => void,
  ) {
    return new Promise<string>((resolve, reject) => {
      let returnData = "";

      const monitor = spawn("bash", [
        "-c",
        `old="$(</sys/class/net/${nic}/statistics/${type}_bytes)"; while $(sleep 1);
  do now=$(</sys/class/net/${nic}/statistics/${type}_bytes); echo $(($now-$old)) B/s old=$old now=$now; old=$now;
  done`,
      ]);

      process.on(process.env.DEV ? "SIGUSR2" : "SIGTERM", () => {
        monitor.kill();
      });

      monitor.stdin.on("error", async (error) => {
        this.logger.error("Error running processs", error);
        reject(error);
      });

      monitor.stderr.on("data", (error) => {
        reject(error.toString());
      });

      monitor.stdout.on("data", (data) => {
        if (onData && typeof onData === "function") {
          onData(data);
        } else {
          returnData += data.toString();
        }
      });

      monitor.on("close", () => {
        resolve(
          returnData || "No data written to memory due to onData() handler",
        );
      });
    });
  }

  private captureData(data: string) {
    try {
      data = data.toString();
      // Example line: "9709 B/s old=83628110721 now=83628120430"
      const match = data.match(/^(\d+)\s+B\/s/);
      if (match) {
        return parseInt(match[1], 10);
      } else {
        this.logger.warn("Could not parse network data:", data);
        return 0;
      }
    } catch (error) {
      this.logger.error("Error capturing metric", data, error);
    }
  }
}
