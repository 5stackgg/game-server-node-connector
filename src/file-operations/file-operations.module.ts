import { Module } from "@nestjs/common";
import { FileOperationsController } from "./file-operations.controller";
import { FileOperationsService } from "./file-operations.service";
import { loggerFactory } from "src/utilities/LoggerFactory";
import { PluginsModule } from "src/plugins/plugins.module";

@Module({
  imports: [PluginsModule],
  controllers: [FileOperationsController],
  providers: [FileOperationsService, loggerFactory()],
  exports: [FileOperationsService],
})
export class FileOperationsModule {}
