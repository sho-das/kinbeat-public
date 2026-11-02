import './env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  // Lets services clean up before the process ends, such as cancelling open Slack connections.
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT) || 4100, process.env.HOST || '127.0.0.1');
}

bootstrap();
