import { Module } from "@nestjs/common";
import { DemosService } from "./demos.service";
import { DemoParserService } from "./demo-parser.service";
import { loggerFactory } from "src/utilities/LoggerFactory";
import { SystemModule } from "src/system/system.module";

@Module({
  imports: [SystemModule],
  providers: [DemosService, DemoParserService, loggerFactory()],
  exports: [],
})
export class DemosModule {
  constructor(private readonly demosService: DemosService) {
    this.demosService.setupScan();
  }
}
