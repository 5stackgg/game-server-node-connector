import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { MatchData } from "./MatchData";

// Only the `id` field is asserted here: it is interpolated into manifest file
// paths, so it must reject anything containing path separators or "..".
function idErrors(id: string) {
  const instance = plainToInstance(MatchData, { id });
  return validateSync(instance, { skipMissingProperties: true }).filter(
    (e) => e.property === "id",
  );
}

describe("MatchData.id validation", () => {
  it("accepts a UUID", () => {
    expect(idErrors("2f8a9c1e-4b7d-4e2a-9c3f-1a2b3c4d5e6f")).toHaveLength(0);
  });

  it("accepts plain alphanumeric ids", () => {
    expect(idErrors("match_123-abc")).toHaveLength(0);
  });

  it("rejects path traversal segments", () => {
    expect(idErrors("../../etc/passwd").length).toBeGreaterThan(0);
    expect(idErrors("a/b").length).toBeGreaterThan(0);
    expect(idErrors("..").length).toBeGreaterThan(0);
  });
});
