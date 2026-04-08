import { ApiConfig } from "./types/ApiConfig";

export default (): {
  api: ApiConfig;
} => {
  const httpPort = parseInt(process.env.API_SERVICE_PORT_HTTP as string);
  const wsPort = parseInt(
    process.env.API_SERVICE_PORT_GAME_SERVER_NODE_WS as string,
  );

  if (isNaN(httpPort)) {
    throw new Error(
      `Invalid API_SERVICE_PORT_HTTP: '${process.env.API_SERVICE_PORT_HTTP}'`,
    );
  }

  if (isNaN(wsPort)) {
    throw new Error(
      `Invalid API_SERVICE_PORT_GAME_SERVER_NODE_WS: '${process.env.API_SERVICE_PORT_GAME_SERVER_NODE_WS}'`,
    );
  }

  return {
    api: {
      url: process.env.API_SERVICE_HOST as string,
      httpPort,
      wsPort,
    },
  };
};
