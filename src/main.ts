import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ConfigService } from "@nestjs/config";
import { NestExpressApplication } from "@nestjs/platform-express";
import { WsAdapter } from "@nestjs/platform-ws";
import { Transport } from "@nestjs/microservices";
import { join } from "path";
import { RedisManagerService } from "./redis/redis-manager/redis-manager.service";
import { create } from "express-handlebars";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableShutdownHooks();

  app.set("trust proxy", () => {
    // TODO - trust proxy
    return true;
  });

  const configService = app.get(ConfigService);

  app.useWebSocketAdapter(new WsAdapter(app));

  const redisManagerService = app.get(RedisManagerService);

  app.connectMicroservice({
    transport: Transport.REDIS,
    options: {
      ...redisManagerService.getConfig("default"),
    },
  });

  await app.startAllMicroservices();

  if (process.env.DEV) {
    app.set("view cache", false);
  }

  app.useStaticAssets(join(__dirname, "..", "public"));

  const srcDirectory = process.env.DEV
  ? join(__dirname, "../..")
  : join(__dirname, "..");

  app.setViewEngine("hbs");
  app.engine(
    "hbs",
    create({
      extname: ".hbs",
      layoutsDir: join(srcDirectory, "views/layouts"),
      partialsDir: join(srcDirectory, "views/partials"),
      defaultLayout: "default",
    }).engine,
  );

  const httpPort = configService.get("app.httpPort") as number;
  await app.listen(httpPort);
}
bootstrap();
