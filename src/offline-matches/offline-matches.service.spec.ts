import fs from "fs";
import yaml from "yaml";
import { Logger } from "@nestjs/common";
import { V1Pod } from "@kubernetes/client-node";
import { OfflineMatchesService } from "./offline-matches.service";
import { MatchData } from "./types/MatchData";

jest.mock("get-port-please", () => ({
  getRandomPort: jest.fn().mockResolvedValue(27015),
}));

describe("OfflineMatchesService", () => {
  let service: OfflineMatchesService;
  let written: Map<string, string>;

  beforeEach(() => {
    process.env.NODE_NAME = "node-1";
    written = new Map();
    jest.spyOn(fs, "writeFileSync").mockImplementation((file, data) => {
      written.set(String(file), String(data));
    });
    service = new OfflineMatchesService({
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.NODE_NAME;
  });

  it("boots CS2 with workshop command filtering off", async () => {
    await service.generateYamlFiles({
      id: "match-1",
      password: "secret",
      options: { type: "Competitive" },
      match_maps: [{ map: { name: "de_inferno" } }],
    } as unknown as MatchData);

    const pod = yaml.parse(
      written.get("/pod-manifests/game-server-match-1.yaml")!,
    ) as V1Pod;
    const params = pod.spec!.containers[0].env!.find(
      (entry) => entry.name === "EXTRA_GAME_PARAMS",
    );

    expect(params!.value!.split(" ")).toContain(
      "-disable_workshop_command_filtering",
    );
  });
});
