import { MongoMemoryServer } from 'mongodb-memory-server';

/** Stops the in-memory mongod of global-setup.ts; its data is thrown away. */
export default async function globalTeardown(): Promise<void> {
	await (globalThis as { __E2E_MONGOD__?: MongoMemoryServer }).__E2E_MONGOD__?.stop();
}
