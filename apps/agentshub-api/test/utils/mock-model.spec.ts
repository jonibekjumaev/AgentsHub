import { createMockModel } from './mock-model';

describe('createMockModel', () => {
	it('resolves chained queries to the queued values, in call order, then null', async () => {
		const model = createMockModel().resolve('findOne', { a: 1 }).resolve('findOne', { a: 2 });

		await expect(model.findOne({ _id: 1 }).select('a').lean().exec()).resolves.toEqual({ a: 1 });
		await expect(model.findOne({ _id: 2 }).exec()).resolves.toEqual({ a: 2 });
		await expect(model.findOne({ _id: 3 }).exec()).resolves.toBeNull();
		expect(model.findOne).toHaveBeenNthCalledWith(2, { _id: 2 });
	});

	it('rejects with a queued error', async () => {
		const duplicateKey = Object.assign(new Error('E11000'), { code: 11000 });
		const model = createMockModel().reject('findOneAndUpdate', duplicateKey);

		await expect(model.findOneAndUpdate({}, {}).exec()).rejects.toBe(duplicateKey);
	});

	it('keeps separate queues per method', async () => {
		const model = createMockModel().resolve('exists', { _id: 'x' });

		await expect(model.findById('x').exec()).resolves.toBeNull();
		await expect(model.exists({ _id: 'x' }).exec()).resolves.toEqual({ _id: 'x' });
	});
});
