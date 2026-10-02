import { Module } from "@nestjs/common";
import { loggerFactory } from "src/utilities/LoggerFactory";
import { ImagePruneService } from "./image-prune.service";

@Module({
  providers: [ImagePruneService, loggerFactory()],
})
export class ImagePruneModule {}
