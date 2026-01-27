import { Module } from "@nestjs/common";
import { FileOperationsController } from "./file-operations.controller";
import { FileOperationsService } from "./file-operations.service";
import { ThrottlerModule } from "@nestjs/throttler";
import { loggerFactory } from "src/utilities/LoggerFactory";

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 60 seconds
        limit: 10, // 10 requests per 60 seconds
      },
    ]),
  ],
  controllers: [FileOperationsController],
  providers: [FileOperationsService, loggerFactory()],
  exports: [FileOperationsService],
})
export class FileOperationsModule {}
