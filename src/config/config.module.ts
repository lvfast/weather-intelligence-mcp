import { Module } from '@nestjs/common';
import { parseConfig, type AppConfig } from './config.schema.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => parseConfig(process.env),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
