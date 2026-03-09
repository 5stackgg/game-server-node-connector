/**
 * SystemService parsing logic tests.
 *
 * The service's parsing methods are private and use execSync/fs, making them
 * hard to test directly. These tests verify the regex patterns and parsing
 * logic extracted from the service methods.
 */
describe("SystemService parsing patterns", () => {
  describe("CPU MHz parsing (from /proc/cpuinfo)", () => {
    const cpuMhzRegex = /cpu MHz\s*:\s*(\d+\.?\d*)/;

    it("parses integer MHz values", () => {
      const line = "cpu MHz\t\t: 3600";
      const match = line.match(cpuMhzRegex);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("3600");
    });

    it("parses decimal MHz values", () => {
      const line = "cpu MHz\t\t: 3600.123";
      const match = line.match(cpuMhzRegex);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("3600.123");
    });

    it("handles varying whitespace", () => {
      const line = "cpu MHz : 2400";
      const match = line.match(cpuMhzRegex);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("2400");
    });
  });

  describe("CPU model GHz extraction", () => {
    const modelGHzRegex = /(\d+\.?\d*)\s*GHz/i;

    it("extracts GHz from Intel model string", () => {
      const model =
        "Model name: Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz";
      const match = model.match(modelGHzRegex);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("3.60");
    });

    it("extracts GHz from AMD model string", () => {
      const model = "Model name: AMD EPYC 7763 64-Core Processor @ 2.45 GHz";
      const match = model.match(modelGHzRegex);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("2.45");
    });

    it("handles integer GHz values", () => {
      const model = "Model name: Some CPU @ 4GHz";
      const match = model.match(modelGHzRegex);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("4");
    });
  });

  describe("dmidecode speed parsing", () => {
    const currentSpeedRegex = /Current Speed:\s*(\d+)\s*MHz/i;
    const maxSpeedRegex = /Max Speed:\s*(\d+)\s*MHz/i;

    it("parses current speed from dmidecode output", () => {
      const output = `
        Version: Intel(R) Core(TM) i7-9700K
        Current Speed: 3600 MHz
        Max Speed: 4900 MHz
      `;
      const match = output.match(currentSpeedRegex);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("3600");
    });

    it("parses max speed from dmidecode output", () => {
      const output = `
        Max Speed: 4900 MHz
      `;
      const match = output.match(maxSpeedRegex);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("4900");
    });

    it("converts MHz to GHz correctly", () => {
      const mhz = "3600";
      const ghz = (parseInt(mhz) / 1000).toString();
      expect(ghz).toBe("3.6");
    });
  });

  describe("lscpu max MHz parsing", () => {
    const maxMHzRegex = /CPU max MHz:\s*(\d+\.?\d*)/i;

    it("parses max MHz from lscpu output", () => {
      const line = "CPU max MHz:         4900.0000";
      const match = line.match(maxMHzRegex);
      expect(match).not.toBeNull();
      expect(parseFloat(match![1]) / 1000).toBeCloseTo(4.9);
    });

    it("parses integer max MHz", () => {
      const line = "CPU max MHz:         3600";
      const match = line.match(maxMHzRegex);
      expect(match).not.toBeNull();
      expect(parseFloat(match![1]) / 1000).toBeCloseTo(3.6);
    });
  });

  describe("CPU governor path parsing", () => {
    it("extracts CPU number from governor file path", () => {
      const filePath = "/host-cpu/cpu3/cpufreq/scaling_governor";
      const parts = filePath.split("/");
      // path.basename(path.dirname(path.dirname(file))) extracts "cpu3"
      const cpuDir = parts[parts.length - 3]; // "cpu3"
      const cpuNum = parseInt(cpuDir.replace("cpu", ""));
      expect(cpuNum).toBe(3);
    });
  });
});
