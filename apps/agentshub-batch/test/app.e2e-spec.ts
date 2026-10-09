import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { AgentsHubBatchModule } from '../src/batch.module';

// runs on the in-memory database of the API e2e setup (D-32), never the dev database
describe('AgentsHubBatchController (e2e)', () => {
	let app: INestApplication;

	beforeEach(async () => {
		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [AgentsHubBatchModule],
		}).compile();

		app = moduleFixture.createNestApplication();
		await app.init();

		const { host } = app.get<Connection>(getConnectionToken());
		if (host !== '127.0.0.1' && host !== 'localhost') {
			await app.close();
			throw new Error(`Refusing to run the e2e tests: connected to ${host}, not the local in-memory mongod`);
		}
	});

	// closes the MongoDB connection and the scheduler, so Jest can exit
	afterEach(async () => {
		await app.close();
	});

	it('/ (GET)', () => {
		return request(app.getHttpServer()).get('/').expect(200).expect('Hello to AgentsHub BATCH server!');
	});
});
