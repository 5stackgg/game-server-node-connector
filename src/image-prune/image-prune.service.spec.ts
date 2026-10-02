import { Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { ImagePruneService } from "./image-prune.service";

jest.mock("child_process", () => ({ execFile: jest.fn() }));

const execFileMock = execFile as unknown as jest.Mock;

describe("ImagePruneService", () => {
  let logger: { log: jest.Mock; warn: jest.Mock };
  let service: ImagePruneService;

  beforeEach(() => {
    execFileMock.mockReset();
    logger = { log: jest.fn(), warn: jest.fn() };
    service = new ImagePruneService(logger as unknown as Logger);
  });

  it("runs the prune script and logs its output", async () => {
    execFileMock.mockImplementation((_cmd, _args, _options, callback) =>
      callback(null, "removed sha256:a\nremoved 1 superseded image(s)\n"),
    );

    await service.prune();

    expect(execFileMock).toHaveBeenCalledWith(
      "bash",
      ["./resources/image-prune.sh"],
      expect.anything(),
      expect.any(Function),
    );
    expect(logger.log.mock.calls).toEqual([
      ["removed sha256:a"],
      ["removed 1 superseded image(s)"],
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs a failed run as a warning", async () => {
    execFileMock.mockImplementation((_cmd, _args, _options, callback) =>
      callback(new Error("exit code 1"), "could not list images\n"),
    );

    await service.prune();

    expect(logger.warn).toHaveBeenCalledWith("could not list images");
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("does not start a second run while one is in progress", async () => {
    let finish = () => {};
    execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
      finish = () => callback(null, "");
    });

    const first = service.prune();
    await service.prune();
    finish();
    await first;

    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});
