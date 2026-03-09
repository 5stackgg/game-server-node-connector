jest.mock("glob", () => ({
  glob: { sync: jest.fn().mockReturnValue([]) },
}));

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

jest.mock("get-port-please", () => ({
  getRandomPort: jest.fn(),
}));

import fs from "fs";
import { glob } from "glob";
import { Logger } from "@nestjs/common";
import { OfflineMatchesService } from "./offline-matches.service";
import { MatchData } from "./types/MatchData";
import { getRandomPort } from "get-port-please";

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedGlobSync = glob.sync as jest.Mock;
const mockedGetRandomPort = getRandomPort as jest.Mock;

function createService() {
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const service = new OfflineMatchesService(logger);
  return { service, logger };
}

function createMockMatchData(overrides: Partial<MatchData> = {}): MatchData {
  return {
    id: "test-match-1",
    password: "test-pass",
    lineup_1_id: "lineup-1",
    lineup_2_id: "lineup-2",
    current_match_map_id: "map-1",
    options: {
      mr: 12,
      type: "competitive",
      best_of: 1,
      coaches: false,
      overtime: true,
      tv_delay: 0,
      knife_round: true,
      ready_setting: "auto",
      timeout_setting: "admin",
      tech_timeout_setting: "admin",
      number_of_substitutes: 0,
      cfg_override: "",
    },
    match_maps: [
      {
        id: "map-1",
        map: { name: "de_mirage" },
        order: 1,
        status: "pending",
        lineup_1_side: "ct",
        lineup_2_side: "t",
      },
    ],
    lineup_1: { id: "lineup-1", name: "Team A", players: [] } as any,
    lineup_2: { id: "lineup-2", name: "Team B", players: [] } as any,
    is_lan: false,
    ...overrides,
  };
}

const YAML_TEMPLATE = [
  "apiVersion: v1",
  "kind: Pod",
  "metadata:",
  '  name: "{{POD_NAME}}"',
  '  namespace: "{{NAMESPACE}}"',
  "  labels:",
  '    app: "{{POD_NAME}}"',
  "spec:",
  "  containers:",
  "    - name: game-server",
  '      image: "{{PLUGIN_IMAGE}}"',
  "      resources:",
  "        requests:",
  '          cpu: "{{CPUS}}"',
  "      env:",
  "        - name: SERVER_PORT",
  '          value: "{{SERVER_PORT}}"',
  "        - name: TV_PORT",
  '          value: "{{TV_PORT}}"',
  "        - name: RCON_PASSWORD",
  '          value: "{{RCON_PASSWORD}}"',
  "        - name: SERVER_PASSWORD",
  '          value: "{{MATCH_PASSWORD}}"',
  "        - name: EXTRA_GAME_PARAMS",
  '          value: "-maxplayers 13 +map {{MAP_NAME}} +sv_lan 1"',
  "        - name: SERVER_ID",
  '          value: "{{SERVER_ID}}"',
  "        - name: SERVER_API_PASSWORD",
  '          value: "{{SERVER_API_PASSWORD}}"',
  "        - name: STEAM_RELAY",
  '          value: "{{STEAM_RELAY}}"',
  "        - name: GAME_SERVER_NODE_ID",
  '          value: "{{GAME_SERVER_NODE_ID}}"',
  "        - name: GAME_SERVER_OFFLINE_MATCH_DATA",
  "          value: '{{GAME_SERVER_OFFLINE_MATCH_DATA}}'",
].join("\n");

function makePodYaml(matchId: string): string {
  return [
    "apiVersion: v1",
    "kind: Pod",
    "metadata:",
    `  name: game-server-${matchId}`,
  ].join("\n");
}

describe("OfflineMatchesService", () => {
  let savedNodeName: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    savedNodeName = process.env.NODE_NAME;
    process.env.NODE_NAME = "test-node";
  });

  afterEach(() => {
    if (savedNodeName === undefined) {
      delete process.env.NODE_NAME;
    } else {
      process.env.NODE_NAME = savedNodeName;
    }
  });

  // ── getMatches ──────────────────────────────────────────────────────

  describe("getMatches", () => {
    it("returns parsed matches from YAML+JSON pairs", async () => {
      const { service } = createService();
      const match1 = createMockMatchData({ id: "match-1" });
      const match2 = createMockMatchData({ id: "match-2" });

      mockedGlobSync.mockReturnValue([
        "/pod-manifests/game-server-match-1.yaml",
        "/pod-manifests/game-server-match-2.yaml",
      ]);

      mockedFs.readFileSync.mockImplementation((filePath: any) => {
        const p = filePath.toString();
        if (p.endsWith("match-1.yaml")) return makePodYaml("match-1");
        if (p.endsWith("match-2.yaml")) return makePodYaml("match-2");
        if (p.endsWith("match-1.json")) return JSON.stringify(match1);
        if (p.endsWith("match-2.json")) return JSON.stringify(match2);
        return "";
      });

      mockedFs.existsSync.mockReturnValue(true);

      const result = await service.getMatches();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("match-1");
      expect(result[1].id).toBe("match-2");
    });

    it("skips entries with missing JSON file", async () => {
      const { service, logger } = createService();
      const match1 = createMockMatchData({ id: "match-1" });

      mockedGlobSync.mockReturnValue([
        "/pod-manifests/game-server-match-1.yaml",
        "/pod-manifests/game-server-match-2.yaml",
      ]);

      mockedFs.readFileSync.mockImplementation((filePath: any) => {
        const p = filePath.toString();
        if (p.endsWith("match-1.yaml")) return makePodYaml("match-1");
        if (p.endsWith("match-2.yaml")) return makePodYaml("match-2");
        if (p.endsWith("match-1.json")) return JSON.stringify(match1);
        return "";
      });

      mockedFs.existsSync.mockImplementation((filePath: any) => {
        return filePath.toString().includes("match-1.json");
      });

      const result = await service.getMatches();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("match-1");
      expect(logger.warn).toHaveBeenCalledWith(
        "Match JSON not found for matchId: match-2",
      );
    });

    it("returns empty array for empty directory", async () => {
      const { service } = createService();
      mockedGlobSync.mockReturnValue([]);

      const result = await service.getMatches();

      expect(result).toEqual([]);
    });
  });

  // ── getMatch ────────────────────────────────────────────────────────

  describe("getMatch", () => {
    it("finds match by ID", async () => {
      const { service } = createService();
      const match = createMockMatchData({ id: "target-match" });

      mockedGlobSync.mockReturnValue([
        "/pod-manifests/game-server-target-match.yaml",
      ]);
      mockedFs.readFileSync.mockImplementation((filePath: any) => {
        const p = filePath.toString();
        if (p.endsWith(".yaml")) return makePodYaml("target-match");
        if (p.endsWith(".json")) return JSON.stringify(match);
        return "";
      });
      mockedFs.existsSync.mockReturnValue(true);

      const result = await service.getMatch("target-match");

      expect(result).toBeDefined();
      expect(result!.id).toBe("target-match");
    });

    it("returns undefined for non-existent match", async () => {
      const { service } = createService();

      mockedGlobSync.mockReturnValue([
        "/pod-manifests/game-server-other.yaml",
      ]);
      mockedFs.readFileSync.mockImplementation((filePath: any) => {
        const p = filePath.toString();
        if (p.endsWith(".yaml")) return makePodYaml("other");
        if (p.endsWith(".json"))
          return JSON.stringify(createMockMatchData({ id: "other" }));
        return "";
      });
      mockedFs.existsSync.mockReturnValue(true);

      const result = await service.getMatch("does-not-exist");

      expect(result).toBeUndefined();
    });
  });

  // ── generateYamlFiles ──────────────────────────────────────────────

  describe("generateYamlFiles", () => {
    it("produces valid YAML with placeholders replaced, writes YAML + JSON files", async () => {
      const { service } = createService();
      const matchData = createMockMatchData();

      mockedGetRandomPort
        .mockResolvedValueOnce(27015)
        .mockResolvedValueOnce(27020);

      mockedFs.readFileSync.mockReturnValue(YAML_TEMPLATE);
      mockedFs.existsSync.mockReturnValue(false);

      await service.generateYamlFiles(matchData);

      // JSON file written for updateMatchData
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        `/pod-manifests/${matchData.id}.json`,
        expect.any(String),
      );

      // YAML file written
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        `/pod-manifests/game-server-${matchData.id}.yaml`,
        expect.any(String),
      );

      // Verify placeholders were replaced in YAML output
      const yamlCall = mockedFs.writeFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".yaml"),
      );
      const writtenYaml = yamlCall![1] as string;

      expect(writtenYaml).toContain(`game-server-${matchData.id}`);
      expect(writtenYaml).toContain("27015");
      expect(writtenYaml).toContain("27020");
      expect(writtenYaml).toContain("de_mirage");
      expect(writtenYaml).toContain("test-node");
      expect(writtenYaml).not.toContain("{{");
    });

    it("allocates random ports via getRandomPort", async () => {
      const { service } = createService();
      const matchData = createMockMatchData();

      mockedGetRandomPort
        .mockResolvedValueOnce(30000)
        .mockResolvedValueOnce(30001);

      mockedFs.readFileSync.mockReturnValue(YAML_TEMPLATE);
      mockedFs.existsSync.mockReturnValue(false);

      await service.generateYamlFiles(matchData);

      expect(mockedGetRandomPort).toHaveBeenCalledTimes(2);

      // Verify ports were written into the JSON (updateMatchData)
      const jsonCall = mockedFs.writeFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".json"),
      );
      const written = JSON.parse(jsonCall![1] as string);
      expect(written.server_port).toBe(30000);
      expect(written.tv_port).toBe(30001);
    });

    it("throws when NODE_NAME is not set", async () => {
      const { service } = createService();
      delete process.env.NODE_NAME;

      const matchData = createMockMatchData();
      mockedFs.existsSync.mockReturnValue(false);

      await expect(service.generateYamlFiles(matchData)).rejects.toThrow(
        "node name is not set",
      );
    });

    it("cleans up on error (calls deleteMatch)", async () => {
      const { service, logger } = createService();
      const matchData = createMockMatchData();

      mockedGetRandomPort.mockRejectedValue(new Error("port error"));
      mockedFs.existsSync.mockReturnValue(false);

      await expect(service.generateYamlFiles(matchData)).rejects.toThrow(
        "port error",
      );

      expect(logger.error).toHaveBeenCalledWith(
        "Error generating YAML files:",
        expect.any(Error),
      );
    });

    it("uses de_dust2 as default map when match_maps is empty", async () => {
      const { service } = createService();
      const matchData = createMockMatchData({ match_maps: [] });

      mockedGetRandomPort
        .mockResolvedValueOnce(27015)
        .mockResolvedValueOnce(27020);

      mockedFs.readFileSync.mockReturnValue(YAML_TEMPLATE);
      mockedFs.existsSync.mockReturnValue(false);

      await service.generateYamlFiles(matchData);

      const yamlCall = mockedFs.writeFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".yaml"),
      );
      const writtenYaml = yamlCall![1] as string;

      expect(writtenYaml).toContain("de_dust2");
    });
  });

  // ── updateMatchData ─────────────────────────────────────────────────

  describe("updateMatchData", () => {
    it("writes JSON file with formatted content", async () => {
      const { service } = createService();
      const matchData = createMockMatchData({ id: "update-test" });

      await service.updateMatchData(matchData);

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        "/pod-manifests/update-test.json",
        JSON.stringify(matchData, null, 2),
      );
    });
  });

  // ── deleteMatch ─────────────────────────────────────────────────────

  describe("deleteMatch", () => {
    it("removes both YAML and JSON files when they exist", async () => {
      const { service, logger } = createService();
      mockedFs.existsSync.mockReturnValue(true);

      await service.deleteMatch("del-1");

      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
        "/pod-manifests/game-server-del-1.yaml",
      );
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
        "/pod-manifests/del-1.json",
      );
      expect(logger.log).toHaveBeenCalledWith(
        "Deleted YAML file for match: del-1",
      );
      expect(logger.log).toHaveBeenCalledWith(
        "Deleted JSON file for match: del-1",
      );
      expect(logger.log).toHaveBeenCalledWith(
        "Successfully deleted match: del-1",
      );
    });

    it("handles missing files gracefully (only deletes what exists)", async () => {
      const { service, logger } = createService();

      mockedFs.existsSync.mockImplementation((filePath: any) => {
        return filePath.toString().endsWith(".yaml");
      });

      await service.deleteMatch("partial-1");

      expect(mockedFs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
        "/pod-manifests/game-server-partial-1.yaml",
      );
      expect(logger.log).toHaveBeenCalledWith(
        "Successfully deleted match: partial-1",
      );
    });

    it("throws when unlinkSync fails", async () => {
      const { service, logger } = createService();
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.unlinkSync.mockImplementation(() => {
        throw new Error("permission denied");
      });

      await expect(service.deleteMatch("err-1")).rejects.toThrow(
        "permission denied",
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Error deleting match err-1:",
        expect.any(Error),
      );
    });
  });

  // ── replacePlaceholders (tested via generateYamlFiles) ─────────────

  describe("replacePlaceholders (via generateYamlFiles)", () => {
    it("replaces all placeholders", async () => {
      const { service } = createService();
      const matchData = createMockMatchData({ id: "ph-test", password: "s3cret" });

      mockedGetRandomPort
        .mockResolvedValueOnce(27015)
        .mockResolvedValueOnce(27020);

      mockedFs.readFileSync.mockReturnValue(YAML_TEMPLATE);
      mockedFs.existsSync.mockReturnValue(false);

      await service.generateYamlFiles(matchData);

      const yamlCall = mockedFs.writeFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".yaml"),
      );
      const writtenYaml = yamlCall![1] as string;

      expect(writtenYaml).toContain("game-server-ph-test");
      expect(writtenYaml).toContain("5stack");
      expect(writtenYaml).toContain("test-node");
      expect(writtenYaml).toContain("ghcr.io/5stackgg/game-server:latest");
      expect(writtenYaml).toContain("27015");
      expect(writtenYaml).toContain("27020");
      expect(writtenYaml).toContain("ph-test");
      expect(writtenYaml).toContain("s3cret");
      expect(writtenYaml).toContain("de_mirage");
      expect(writtenYaml).toContain("api-password");
      expect(writtenYaml).toContain("false");
      expect(writtenYaml).toContain('"1"');
      expect(writtenYaml).not.toMatch(/\{\{[A-Z_]+\}\}/);
    });

    it("replaces multiple occurrences of the same placeholder", async () => {
      const { service } = createService();
      const matchData = createMockMatchData({ id: "dup-test" });

      mockedGetRandomPort
        .mockResolvedValueOnce(27015)
        .mockResolvedValueOnce(27020);

      // Template with POD_NAME appearing twice (mirrors real template)
      const templateWithDups = [
        "metadata:",
        '  name: "{{POD_NAME}}"',
        "  labels:",
        '    app: "{{POD_NAME}}"',
        '  port: {{SERVER_PORT}}',
        '  tvPort: {{TV_PORT}}',
        '  rcon: "{{RCON_PASSWORD}}"',
        '  pass: "{{MATCH_PASSWORD}}"',
        '  map: "{{MAP_NAME}}"',
        '  serverId: "{{SERVER_ID}}"',
        '  ns: "{{NAMESPACE}}"',
        '  node: "{{GAME_SERVER_NODE_ID}}"',
        '  image: "{{PLUGIN_IMAGE}}"',
        '  apiPass: "{{SERVER_API_PASSWORD}}"',
        '  relay: "{{STEAM_RELAY}}"',
        '  cpus: "{{CPUS}}"',
        "  data: '{{GAME_SERVER_OFFLINE_MATCH_DATA}}'",
      ].join("\n");

      mockedFs.readFileSync.mockReturnValue(templateWithDups);
      mockedFs.existsSync.mockReturnValue(false);

      await service.generateYamlFiles(matchData);

      const yamlCall = mockedFs.writeFileSync.mock.calls.find(
        (call) => call[0].toString().endsWith(".yaml"),
      );
      const writtenYaml = yamlCall![1] as string;

      const podNameOccurrences = (
        writtenYaml.match(/game-server-dup-test/g) || []
      ).length;
      expect(podNameOccurrences).toBe(2);
      expect(writtenYaml).not.toContain("{{POD_NAME}}");
    });
  });
});
