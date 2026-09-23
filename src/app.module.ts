import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';

@Module({
  imports: [ConfigModule],
})
export class AppModule {}
