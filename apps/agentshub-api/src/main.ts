import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { graphqlUploadExpress } from 'graphql-upload';
import * as express from 'express';
import { WsAdapter } from '@nestjs/platform-ws';
import { registerProcessHandlers } from './libs/process-handlers';
import { uploadMaxFileSize, uploadMaxFiles } from './libs/config';

async function bootstrap() {
	// before anything async: an orphaned rejection is logged instead of exiting the API (B22)
	registerProcessHandlers();
	const app = await NestFactory.create(AppModule);
	configureApp(app);
	app.enableCors({ origin: true, credentials: true });

	app.use(graphqlUploadExpress({ maxFileSize: uploadMaxFileSize, maxFiles: uploadMaxFiles }));
	app.use('/uploads', express.static('./uploads'));

	console.log('localhost:', process.env.PORT_API);

	app.useWebSocketAdapter(new WsAdapter(app));
	await app.listen(process.env.PORT_API ?? 3000);
}
bootstrap().catch((error) => {
	console.error('Bootstrap failed:', error);
	process.exit(1);
});
