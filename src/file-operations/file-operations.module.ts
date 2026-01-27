import { Module } from "@nestjs/common";
import { FileOperationsController } from "./file-operations.controller";
import { FileOperationsService } from "./file-operations.service";
import { loggerFactory } from "src/utilities/LoggerFactory";

@Module({
  controllers: [FileOperationsController],
  providers: [FileOperationsService, loggerFactory()],
  exports: [FileOperationsService],
})
export class FileOperationsModule {}
