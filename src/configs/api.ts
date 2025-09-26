import { ApiConfig } from "./types/ApiConfig";

export default (): {
  api: ApiConfig;
} => ({
  api: {
    url: process.env.API_SERVICE_HOST as string,
    httpPort: parseInt(process.env.API_SERVICE_PORT_HTTP as string),
    wsPort: parseInt(
      process.env.API_SERVICE_PORT_GAME_SERVER_NODE_WS as string,
    ),
  },
});
