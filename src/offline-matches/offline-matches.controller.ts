import {
  Controller,
  Get,
  Post,
  Render,
  Req,
  Param,
  Res,
  UseGuards,
} from "@nestjs/common";
import { OfflineMatchesService } from "./offline-matches.service";
import { MatchData } from "./types/MatchData";
import { type Request, type Response } from "express";
import { BasicGuardGuard } from "./basic-guard.guard";
import { KubernetesService } from "src/kubernetes/kubernetes.service";
import { NetworkService } from "src/system/network.service";

@Controller()
export class OfflineMatchesController {
  constructor(
    private readonly kubernetesService: KubernetesService,
    private readonly offlineMatchesService: OfflineMatchesService,
    private readonly networkService: NetworkService,
  ) {}

  @Get()
  @UseGuards(BasicGuardGuard)
  @Render("index")
  public async index() {
    return {
      lanIP: this.networkService.getLanIP(),
      matches: await this.offlineMatchesService.getMatches(),
      hasGameServerImage: await this.kubernetesService.hasGameServerImage(),
    };
  }

  @Post("matches")
  @UseGuards(BasicGuardGuard)
  public async generateYaml(@Req() req: Request, @Res() res: Response) {
    await this.offlineMatchesService.generateYamlFiles(
      (await req.body) as unknown as MatchData,
    );
    return res.redirect("/");
  }

  @Get("matches")
  @UseGuards(BasicGuardGuard)
  @Render("match")
  public async createMatch() {
    return {
      hasGameServerImage: await this.kubernetesService.hasGameServerImage(),
    };
  }

  @Get("matches/:id")
  @UseGuards(BasicGuardGuard)
  @Render("match")
  public async getMatch(@Param("id") id: string) {
    const match = await this.offlineMatchesService.getMatch(id);

    return {
      match,
      hasGameServerImage: await this.kubernetesService.hasGameServerImage(),
    };
  }

  @Post("matches/:id")
  @UseGuards(BasicGuardGuard)
  public async updateMatch(
    @Param("id") id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.offlineMatchesService.updateMatchData(
      (await req.body) as unknown as MatchData,
    );
    return res.redirect("/");
  }

  @Post("matches/:id/delete")
  @UseGuards(BasicGuardGuard)
  public async deleteMatch(@Param("id") id: string, @Res() res: Response) {
    await this.offlineMatchesService.deleteMatch(id);
    return res.redirect("/");
  }
}
