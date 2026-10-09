import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AgentsHubBatchModule } from '../src/batch.module';

describe('AgentsHubBatchController (e2e)', () => {
	let app: INestApplication;

	beforeEach(async () => {
		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [AgentsHubBatchModule],
		}).compile();

		app = moduleFixture.createNestApplication();
		await app.init();
	});

	// closes the MongoDB connection and the scheduler, so Jest can exit
	afterEach(async () => {
		await app.close();
	});

	it('/ (GET)', () => {
		return request(app.getHttpServer()).get('/').expect(200).expect('Hello to AgentsHub BATCH server!');
	});
});
