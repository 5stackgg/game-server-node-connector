import { ApiConfig } from "./types/ApiConfig";

export default (): {
  api: ApiConfig;
} => {
  const httpPort = parseInt(process.env.API_SERVICE_PORT_HTTP as string);

  if (isNaN(httpPort)) {
    throw new Error(
      `Invalid API_SERVICE_PORT_HTTP: '${process.env.API_SERVICE_PORT_HTTP}'`,
    );
  }

  return {
    api: {
      url: process.env.API_SERVICE_HOST as string,
      httpPort,
    },
  };
};
