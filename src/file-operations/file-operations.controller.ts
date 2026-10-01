import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Body,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  Headers,
  BadRequestException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { FileOperationsService } from "./file-operations.service";
import { ServerArchiveService } from "./server-archive.service";
import {
  ListDirectoryDto,
  ReadFileDto,
  CreateDirectoryDto,
  DeleteItemDto,
  MoveItemDto,
  RenameItemDto,
  GetFileStatsDto,
  UploadFileDto,
  WriteFileDto,
} from "./dto/file-operation.dto";

@Controller("file-operations")
export class FileOperationsController {
  constructor(
    private readonly fileOperationsService: FileOperationsService,
    private readonly serverArchiveService: ServerArchiveService,
  ) {}

  @Get("servers/:serverId/size")
  async serverDirectorySize(
    @Param("serverId", new ParseUUIDPipe()) serverId: string,
  ) {
    return this.serverArchiveService.summary(serverId);
  }

  @Get("servers/:serverId/archive")
  async archiveServerDirectory(
    @Param("serverId", new ParseUUIDPipe()) serverId: string,
    @Res() res: Response,
  ) {
    const inventory = await this.serverArchiveService.inventory(serverId);

    if (!inventory.exists) {
      res.status(410).json({ message: "This server has no files on the node" });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "application/x-tar");
    res.setHeader("X-5stack-Entries", inventory.entries.length);
    res.setHeader("X-5stack-Bytes", inventory.bytes);
    res.setHeader("X-5stack-Archive-Bytes", inventory.archiveBytes);

    await this.serverArchiveService.pipeArchive(
      serverId,
      inventory.entries,
      res,
    );
  }

  @Post("servers/:serverId/extract")
  async extractServerDirectory(
    @Param("serverId", new ParseUUIDPipe()) serverId: string,
    @Headers("content-type") contentType: string | undefined,
    @Headers("x-5stack-expected-entries") expectedEntries: string | undefined,
    @Headers("x-5stack-expected-bytes") expectedBytes: string | undefined,
    @Req() req: Request,
  ) {
    if (!contentType?.startsWith("application/x-tar")) {
      throw new UnsupportedMediaTypeException("Expected application/x-tar");
    }

    const entries = Number(expectedEntries);
    const bytes = Number(expectedBytes);

    if (
      !Number.isSafeInteger(entries) ||
      !Number.isSafeInteger(bytes) ||
      entries < 0 ||
      bytes < 0
    ) {
      throw new BadRequestException(
        "x-5stack-expected-entries and x-5stack-expected-bytes are required",
      );
    }

    return {
      success: true,
      ...(await this.serverArchiveService.extract(serverId, req, {
        entries,
        bytes,
      })),
    };
  }

  @Delete("servers/:serverId")
  async deleteServerDirectory(
    @Param("serverId", new ParseUUIDPipe()) serverId: string,
  ) {
    return {
      success: true,
      ...(await this.serverArchiveService.remove(serverId)),
    };
  }

  @Get("list")
  async listDirectory(@Query() query: ListDirectoryDto) {
    return this.fileOperationsService.listDirectory(query.basePath, query.path);
  }

  @Get("read")
  async readFile(@Query() query: ReadFileDto) {
    return this.fileOperationsService.readFile(query.basePath, query.path);
  }

  @Post("create-directory")
  async createDirectory(@Body() body: CreateDirectoryDto) {
    await this.fileOperationsService.createDirectory(
      body.basePath,
      body.dirPath,
    );
    return { success: true };
  }

  @Delete("delete")
  async deleteItem(@Body() body: DeleteItemDto) {
    await this.fileOperationsService.deleteFileOrDirectory(
      body.basePath,
      body.path,
    );
    return { success: true };
  }

  @Post("move")
  async moveItem(@Body() body: MoveItemDto) {
    await this.fileOperationsService.moveFileOrDirectory(
      body.basePath,
      body.sourcePath,
      body.destPath,
    );
    return { success: true };
  }

  @Post("rename")
  async renameItem(@Body() body: RenameItemDto) {
    await this.fileOperationsService.renameFileOrDirectory(
      body.basePath,
      body.oldPath,
      body.newPath,
    );
    return { success: true };
  }

  @Post("write")
  async writeFile(@Body() body: WriteFileDto) {
    await this.fileOperationsService.writeTextFile(
      body.basePath,
      body.filePath,
      body.content,
    );
    return { success: true };
  }

  @Get("stats")
  async getFileStats(@Query() query: GetFileStatsDto) {
    return this.fileOperationsService.getFileStats(query.basePath, query.path);
  }

  @Post("upload")
  @UseInterceptors(FileInterceptor("file"))
  async uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 100 * 1024 * 1024 }), // 100MB
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() body: UploadFileDto,
  ) {
    await this.fileOperationsService.uploadFile(
      body.basePath,
      body.filePath,
      file.buffer,
    );
    return { success: true };
  }
}
