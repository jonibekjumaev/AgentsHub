/**
 * Jest setupFiles for the e2e suites: runs in each test file before its imports, so it sets the environment before
 * any module reads it (DatabaseModule reads MONGODB_DEV, AuthModule reads SECRET_TOKEN when it is imported).
 *
 * The app still loads .env through ConfigModule.forRoot(), but that never overrides a variable that is already set,
 * so these values win (D-32). Refuses to run unless the database is the local in-memory mongod.
 */
const uri = process.env.E2E_MONGODB_URI;

if (!uri) throw new Error('E2E_MONGODB_URI is not set: run the e2e suites through their jest-e2e.json (globalSetup)');

/** Throws unless `uri` is a plain mongodb:// URI whose hosts are all on this machine. */
export const assertLocalMongoUri = (value: string): void => {
	const match = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/.exec(value);
	const hosts = match ? match[1].split(',').map((host) => host.replace(/:\d+$/, '')) : [];
	const isLocal = hosts.length > 0 && hosts.every((host) => host === '127.0.0.1' || host === 'localhost');
	if (!isLocal) throw new Error('Refusing to run the e2e tests: the database is not a local in-memory mongod');
};

assertLocalMongoUri(uri);

process.env.NODE_ENV = 'test'; // never 'production': DatabaseModule would use MONGODB_PROD
process.env.MONGODB_DEV = uri;
process.env.MONGODB_PROD = uri; // in case anything still asks for production
process.env.SECRET_TOKEN = 'e2e-throwaway-secret'; // only this test run knows it; never the real SECRET_TOKEN
