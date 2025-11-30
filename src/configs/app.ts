import { AppConfig } from "./types/AppConfig";

export default (): {
  app: AppConfig;
} => ({
  app: {
    httpPort: process.env.HEALTH_PORT
      ? parseInt(process.env.HEALTH_PORT)
      : 8585,
    basicAuthUser: "5s",
    basicAuthPass: process.env.NODE_NAME as string,
  },
});
