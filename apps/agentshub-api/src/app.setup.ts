import { INestApplication, ValidationPipe } from '@nestjs/common';
import { LoggingInterceptor } from './libs/interceptor/logging.interceptor';

/**
 * The global request pipeline, shared by main.ts and the e2e tests so both run the same validation and logging.
 * The ValidationPipe enforces every DTO rule (e.g. D-14 signup types, D-26 passwords); without it they are skipped.
 */
export function configureApp(app: INestApplication): INestApplication {
	app.useGlobalPipes(new ValidationPipe());
	app.useGlobalInterceptors(new LoggingInterceptor());
	return app;
}
