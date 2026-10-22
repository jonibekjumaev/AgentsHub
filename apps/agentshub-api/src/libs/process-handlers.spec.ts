import { spawnSync } from 'child_process';
import { registerProcessHandlers } from './process-handlers';

// B22: an orphaned rejection left by graphql-js must be logged, not exit the API process
describe('registerProcessHandlers (B22)', () => {
	let unregister: () => void;
	const logger = { error: jest.fn<void, [string]>() };

	beforeEach(() => {
		logger.error.mockClear();
		unregister = registerProcessHandlers(logger);
	});
	afterEach(() => unregister());

	it('B22: logs an unhandled rejection with its message', () => {
		process.emit('unhandledRejection', new Error('late failure'), Promise.resolve());
		expect(logger.error).toHaveBeenCalledTimes(1);
		expect(logger.error.mock.calls[0][0]).toContain('late failure');
	});

	it('B22: redacts sensitive text in the logged reason (S15)', () => {
		process.emit('unhandledRejection', 'memberPassword: "secret123"', Promise.resolve());
		expect(logger.error.mock.calls[0][0]).not.toContain('secret123');
	});

	it('B22: registers only once, a second call is a no-op', () => {
		const before = process.listenerCount('unhandledRejection');
		const second = registerProcessHandlers(logger);
		expect(process.listenerCount('unhandledRejection')).toBe(before);
		second();
		expect(process.listenerCount('unhandledRejection')).toBe(before);
	});

	// The real process: Jest's sandbox catches rejections itself, so the crash and the fix are checked in a child Node
	describe('in a child Node process (the legacy-data crash)', () => {
		const handlerPath = `${__dirname}/process-handlers`;
		const script = (withHandler: boolean) => `
			const { buildSchema, graphql } = require('graphql');
			${withHandler ? `require(${JSON.stringify(handlerPath)}).registerProcessHandlers({ error: (m) => console.log('LOGGED', m.split(String.fromCharCode(10))[0]) });` : ''}
			// item 1 has a null non-null field (like legacy memberBriefs), item 0 an async non-null field that fails later
			const schema = buildSchema('type M { id: Int!, late: Boolean!, n: Int! } type Query { list: [M!]! }');
			const rootValue = { list: () => [
				{ id: 1, n: 1, late: () => new Promise((_, reject) => setTimeout(() => reject(new Error('late item')), 5)) },
				{ id: 2, n: null, late: () => true },
			] };
			graphql({ schema, source: '{ list { id late n } }', rootValue }).then((r) => console.log('RESPONSE', r.errors[0].message));
			setTimeout(() => console.log('STILL SERVING'), 50);
		`;
		const run = (withHandler: boolean) =>
			spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', script(withHandler)], {
				cwd: process.cwd(),
				encoding: 'utf8',
				timeout: 30000,
			});

		it('B22: without the handler the late rejection exits the process (the bug)', () => {
			const result = run(false);
			expect(result.stdout).toContain('RESPONSE Cannot return null for non-nullable field M.n.');
			expect(result.stdout).not.toContain('STILL SERVING');
			expect(result.status).not.toBe(0);
		});

		it('B22: with the handler the client gets the GraphQL error, the rejection is logged and the process keeps running', () => {
			const result = run(true);
			expect(result.stdout).toContain('RESPONSE Cannot return null for non-nullable field M.n.');
			expect(result.stdout).toContain('LOGGED Unhandled promise rejection: Error: late item');
			expect(result.stdout).toContain('STILL SERVING');
			expect(result.status).toBe(0);
		});
	});
});
