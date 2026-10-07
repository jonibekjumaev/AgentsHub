import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ComponentsModule } from '../apps/agentshub-api/src/components/components.module';
import { DatabaseModule } from '../apps/agentshub-api/src/database/database.module';

/**
 * The API's services without GraphQL and the socket gateway, for `npm run seed` and `npm run create-admin`.
 * ConfigModule.forRoot() loads .env when this file is imported, so process.env is ready before bootstrap.
 */
@Module({
	imports: [ConfigModule.forRoot(), DatabaseModule, ComponentsModule],
})
export class ScriptsModule {}
