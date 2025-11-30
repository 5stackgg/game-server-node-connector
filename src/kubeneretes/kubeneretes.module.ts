import { Module } from "@nestjs/common";
import { KubeneretesService } from "./kubeneretes.service";
import { loggerFactory } from "../utilities/LoggerFactory";
import { SystemModule } from "src/system/system.module";

@Module({
  imports: [SystemModule],
  providers: [KubeneretesService, loggerFactory()],
  exports: [KubeneretesService],
})
export class KubeneretesModule {}
