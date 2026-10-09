import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

/**
 * The API as main.ts builds it: AppModule with the shared configureApp() pipeline (ValidationPipe, LoggingInterceptor)
 * and the ws adapter, on the in-memory database of e2e-env.ts. Checked again after connecting: a connection to anything
 * but this machine closes the app and fails the suite before a single request is sent.
 */
export const createE2eApp = async (): Promise<{ app: INestApplication; connection: Connection }> => {
	const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
	const app = configureApp(moduleRef.createNestApplication());
	app.useWebSocketAdapter(new WsAdapter(app));
	await app.init();

	const connection = app.get<Connection>(getConnectionToken());
	if (connection.host !== '127.0.0.1' && connection.host !== 'localhost') {
		await app.close();
		throw new Error(`Refusing to run the e2e tests: connected to ${connection.host}, not the local in-memory mongod`);
	}
	return { app, connection };
};

export type GqlError = { message: string; extensions?: { code?: string; validationErrors?: string[] } };
export type GqlResponse<T = Record<string, unknown>> = { data?: T | null; errors?: GqlError[] };

/** POSTs one GraphQL operation; `token` is sent as a Bearer token. Returns the body, whatever the HTTP status. */
export const gql = async <T = Record<string, unknown>>(
	app: INestApplication,
	query: string,
	variables: Record<string, unknown> = {},
	token?: string,
): Promise<GqlResponse<T>> => {
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
	const response = await request(app.getHttpServer()).post('/graphql').set(headers).send({ query, variables });
	return response.body as GqlResponse<T>;
};

/** The code and message of the only error of a response; fails if the call succeeded. */
export const onlyError = (response: GqlResponse): { code?: string; message: string } => {
	expect(response.errors).toHaveLength(1);
	const [error] = response.errors!;
	return { code: error.extensions?.code, message: error.message };
};
