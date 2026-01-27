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
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { FileOperationsService } from "./file-operations.service";
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
  constructor(private readonly fileOperationsService: FileOperationsService) {}

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
