import { Controller, Get } from "@nestjs/common";
import { EventPattern } from "@nestjs/microservices";
import { WebrtcService } from "src/webrtc/webrtc.service";

@Controller("system")
export class SystemController {
  constructor(private readonly webrtcService: WebrtcService) {}

  @Get("healthz")
  public async status() {
    return;
  }

  @EventPattern(`offer.${process.env.NODE_NAME}`)
  handleOffer(data: any) {
    this.webrtcService.handleOffer(data);
  }

  @EventPattern(`candidate.${process.env.NODE_NAME}`)
  handleCandidate(data: any) {
    this.webrtcService.handleCandidate(data);
  }
}
