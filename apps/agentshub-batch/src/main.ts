import { NestFactory } from '@nestjs/core';
import { AgentsHubBatchModule } from './batch.module';
import { registerProcessHandlers } from '../../agentshub-api/src/libs/process-handlers';

async function bootstrap() {
	// an orphaned rejection in a nightly job is logged instead of exiting the batch app (B22)
	registerProcessHandlers();
	const app = await NestFactory.create(AgentsHubBatchModule);
	await app.listen(process.env.PORT_BATCH ?? 3008);

	console.log('localhost:', process.env.PORT_BATCH);
}
bootstrap().catch((error) => {
	console.error('Bootstrap failed:', error);
	process.exit(1);
});
