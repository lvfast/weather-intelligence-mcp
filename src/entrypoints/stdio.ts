import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';

async function bootstrap(): Promise<void> {
  const context = await NestFactory.createApplicationContext(AppModule);
  await context.close();
}

await bootstrap();
