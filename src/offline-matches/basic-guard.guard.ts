import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { ConfigService } from "@nestjs/config";
import { AppConfig } from "src/configs/types/AppConfig";

@Injectable()
export class BasicGuardGuard implements CanActivate {
  private readonly appConfig: AppConfig;
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {
    this.appConfig = this.configService.get<AppConfig>("app")!;
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const authHeader = request.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      response.setHeader("WWW-Authenticate", 'Basic realm="Restricted"');
      response.status(401).send("Authentication required.");
      return false;
    }

    const base64Credentials = authHeader.split(" ")[1];
    let credentials: string;
    try {
      credentials = Buffer.from(base64Credentials, "base64").toString("utf8");
    } catch (error: any) {
      this.logger.error("Error decoding base64 credentials", error);
      return false;
    }

    const [username, password] = credentials.split(":");
    if (
      username === this.appConfig.basicAuthUser &&
      password === this.appConfig.basicAuthPass
    ) {
      return true;
    }

    response.setHeader("WWW-Authenticate", 'Basic realm="Restricted"');
    response.status(401).send("Authentication required.");

    return false;
  }
}
