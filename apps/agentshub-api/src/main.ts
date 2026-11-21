import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
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
	const app = await NestFactory.create<NestExpressApplication>(AppModule);
	// D-51: behind a reverse proxy, TRUST_PROXY (e.g. 1, or the proxy's address) makes req.ip the real client address,
	// which the login throttle counts by. Left unset, req.ip is the direct peer.
	const trustProxy = process.env.TRUST_PROXY;
	if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
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
