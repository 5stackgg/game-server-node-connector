import {
  MessageBody,
  ConnectedSocket,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import { RconService } from "../rcon/rcon.service";

@WebSocketGateway()
export class RconGateway {
  constructor(private readonly rconService: RconService) {}

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
