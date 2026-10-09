import { Module } from '@nestjs/common';
import { BatchController } from './batch.controller';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { ScheduleModule } from '@nestjs/schedule';
import { BatchJobsModule } from './batch-jobs.module';

@Module({
	imports: [ConfigModule.forRoot(), DatabaseModule, ScheduleModule.forRoot(), BatchJobsModule],
	controllers: [BatchController],
})
export class AgentsHubBatchModule {}
