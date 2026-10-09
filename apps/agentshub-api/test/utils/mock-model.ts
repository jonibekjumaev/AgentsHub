/**
 * A fake Mongoose model for service unit tests (no database). Each query method is a jest.fn() that returns a
 * chainable query: `.select()`, `.lean()`, `.sort()`… return the same query, and `.exec()` resolves to the value
 * queued for that method. Tests check the filters and updates through the jest.fn() calls.
 *
 *   const model = createMockModel();
 *   model.resolve('findOne', { productStatus: 'ACTIVE' });   // next findOne(...).exec() → this value
 *   expect(model.findOneAndUpdate).toHaveBeenCalledWith({ _id, productStatus: 'ACTIVE' }, expect.anything(), …);
 */

const queryMethods = [
	'find',
	'findOne',
	'findById',
	'findOneAndUpdate',
	'findByIdAndUpdate',
	'findOneAndDelete',
	'findByIdAndDelete',
	'updateOne',
	'updateMany',
	'exists',
	'aggregate',
	'countDocuments',
] as const;

export type QueryMethod = (typeof queryMethods)[number];

const chainMethods = ['select', 'lean', 'sort', 'skip', 'limit', 'populate'] as const;

export type MockQuery = Record<(typeof chainMethods)[number], jest.Mock<MockQuery, unknown[]>> & {
	exec: jest.Mock<Promise<unknown>, []>;
};

export type MockModel = Record<QueryMethod, jest.Mock<MockQuery, unknown[]>> & {
	create: jest.Mock<Promise<unknown>, [unknown]>;
	/** Queues the value that the next call of `method` resolves to (in call order). Unqueued calls resolve to null. */
	resolve: (method: QueryMethod, value: unknown) => MockModel;
	/** Queues an error that the next call of `method` rejects with (e.g. an Error with `code: 11000`). */
	reject: (method: QueryMethod, error: Error) => MockModel;
};

const createQuery = (result: () => Promise<unknown>): MockQuery => {
	const query = { exec: jest.fn(result) } as unknown as MockQuery;
	for (const name of chainMethods) query[name] = jest.fn(() => query);
	return query;
};

export const createMockModel = (): MockModel => {
	const queued = new Map<QueryMethod, Array<() => Promise<unknown>>>();
	const next = (method: QueryMethod) => queued.get(method)?.shift() ?? (() => Promise.resolve(null));
	const enqueue = (method: QueryMethod, result: () => Promise<unknown>) => {
		queued.set(method, [...(queued.get(method) ?? []), result]);
	};

	const model = { create: jest.fn() } as unknown as MockModel;
	for (const method of queryMethods) model[method] = jest.fn(() => createQuery(next(method)));

	model.resolve = (method, value) => {
		enqueue(method, () => Promise.resolve(value));
		return model;
	};
	model.reject = (method, error) => {
		enqueue(method, () => Promise.reject(error));
		return model;
	};
	return model;
};
