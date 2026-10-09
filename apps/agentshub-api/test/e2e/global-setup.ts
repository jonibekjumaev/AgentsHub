import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Jest globalSetup for the API and batch e2e suites (D-32): a throwaway in-memory mongod per run, so the tests never
 * touch the dev database (`agentsHub`) or any Atlas cluster. The workers inherit E2E_MONGODB_URI; e2e-env.ts turns
 * it into MONGODB_DEV and refuses to run unless it points at this machine.
 */
export default async function globalSetup(): Promise<void> {
	const mongod = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
	(globalThis as { __E2E_MONGOD__?: MongoMemoryServer }).__E2E_MONGOD__ = mongod;
	process.env.E2E_MONGODB_URI = mongod.getUri('agentsHubE2e');
}
