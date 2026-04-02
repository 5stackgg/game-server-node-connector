import {
  MessageBody,
  ConnectedSocket,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { RconService } from "../rcon/rcon.service";

@WebSocketGateway()
export class RconGateway {
  private readonly logger = new Logger(RconGateway.name);

  constructor(private readonly rconService: RconService) {}

  private static readonly MAX_COMMAND_LENGTH = 512;

  private validateCommand(command: string): string | null {
    if (!command || typeof command !== "string") {
      return "invalid command";
    }
    if (command.length > RconGateway.MAX_COMMAND_LENGTH) {
      return "command too long";
    }
    if (/[;\n\r]/.test(command)) {
      return "command contains invalid characters";
    }
    return null;
  }

  @SubscribeMessage("rcon")
  async rconEvent(
    @MessageBody()
    data: {
      uuid: string;
      command: string;
      matchId: string;
    },
    @ConnectedSocket() client: WebSocket,
  ) {
    const validationError = this.validateCommand(data.command);
    if (validationError) {
      client.send(
        JSON.stringify({
          event: "rcon",
          data: {
            uuid: data.uuid,
            result: validationError,
          },
        }),
      );
      return;
    }

    this.logger.log(
      `RCON [${data.matchId}]: ${data.command}`,
    );

    const rcon = await this.rconService.connect(data.matchId);

    if (!rcon) {
      client.send(
        JSON.stringify({
          event: "rcon",
          data: {
            uuid: data.uuid,
            result: "unable to connect to rcon",
          },
        }),
      );

      return;
    }

    client.send(
      JSON.stringify({
        event: "rcon",
        data: {
          uuid: data.uuid,
          result: await rcon.send(data.command),
        },
      }),
    );
  }
}
