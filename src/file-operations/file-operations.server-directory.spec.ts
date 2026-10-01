import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import request from "supertest";
import { FileOperationsController } from "./file-operations.controller";
import { FileOperationsService } from "./file-operations.service";
import { SERVERS_ROOT, ServerArchiveService } from "./server-archive.service";

describe("server directory routes", () => {
  const serverId = "0b6f1b8e-7f4a-4d8e-9a57-3c1f2f0f4a11";
  let workdir: string;
  let source: INestApplication;
  let target: INestApplication;

  const boot = async (root: string) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FileOperationsController],
      providers: [
        { provide: FileOperationsService, useValue: {} },
        { provide: SERVERS_ROOT, useValue: root },
        ServerArchiveService,
      ],
    }).compile();

    const app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();

    return app;
  };

  const binary = (
    res: any,
    callback: (error: Error | null, body: Buffer) => void,
  ) => {
    const chunks: Array<Buffer> = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => callback(null, Buffer.concat(chunks)));
  };

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "server-routes-"));
    await fs.mkdir(path.join(workdir, "a", serverId, "cfg"), {
      recursive: true,
    });
    await fs.mkdir(path.join(workdir, "b"));
    await fs.writeFile(
      path.join(workdir, "a", serverId, "cfg/server.cfg"),
      "hostname moved",
    );
    source = await boot(path.join(workdir, "a"));
    target = await boot(path.join(workdir, "b"));
  });

  afterEach(async () => {
    await source.close();
    await target.close();
    await fs.rm(workdir, { recursive: true, force: true });
  });

  it("streams a server directory out of one node and into another", async () => {
    const size = await request(source.getHttpServer())
      .get(`/file-operations/servers/${serverId}/size`)
      .expect(200);

    expect(size.body).toMatchObject({ exists: true, entries: 2, bytes: 14 });

    const archive = await request(source.getHttpServer())
      .get(`/file-operations/servers/${serverId}/archive`)
      .buffer(true)
      .parse(binary)
      .expect(200)
      .expect("content-type", /application\/x-tar/)
      .expect("x-5stack-entries", "2")
      .expect("x-5stack-bytes", "14");

    await request(target.getHttpServer())
      .post(`/file-operations/servers/${serverId}/extract`)
      .set("content-type", "application/x-tar")
      .set("x-5stack-expected-entries", "2")
      .set("x-5stack-expected-bytes", "14")
      .send(archive.body)
      .expect(201, { success: true, entries: 2, bytes: 14 });

    await expect(
      fs.readFile(path.join(workdir, "b", serverId, "cfg/server.cfg"), "utf8"),
    ).resolves.toBe("hostname moved");

    await request(source.getHttpServer())
      .delete(`/file-operations/servers/${serverId}`)
      .expect(200, { success: true, existed: true });

    expect(await fs.readdir(path.join(workdir, "a"))).toEqual([]);
  });

  it("answers 410 for a server with no directory, so the caller can skip the copy", async () => {
    await request(target.getHttpServer())
      .get(`/file-operations/servers/${serverId}/archive`)
      .expect(410);
  });

  it("refuses an upload that is not a tar", async () => {
    await request(target.getHttpServer())
      .post(`/file-operations/servers/${serverId}/extract`)
      .set("content-type", "application/json")
      .set("x-5stack-expected-entries", "0")
      .set("x-5stack-expected-bytes", "0")
      .send({})
      .expect(415);
  });

  it("refuses an upload without the counts it is checked against", async () => {
    await request(target.getHttpServer())
      .post(`/file-operations/servers/${serverId}/extract`)
      .set("content-type", "application/x-tar")
      .send(Buffer.alloc(1024))
      .expect(400);
  });

  it("refuses a server id that is not a uuid", async () => {
    await request(target.getHttpServer())
      .delete("/file-operations/servers/..")
      .expect(404);
    await request(target.getHttpServer())
      .get("/file-operations/servers/not-a-uuid/size")
      .expect(400);
  });
});
