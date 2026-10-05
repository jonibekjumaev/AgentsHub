import { NestFactory } from '@nestjs/core';
import { AgentsHubBatchModule } from './batch.module';

async function bootstrap() {
	const app = await NestFactory.create(AgentsHubBatchModule);
	await app.listen(process.env.PORT_BATCH ?? 3008);

	console.log('localhost:', process.env.PORT_BATCH);
}
bootstrap().catch((error) => {
	console.error('Bootstrap failed:', error);
	process.exit(1);
});
