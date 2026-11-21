import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { embeddingBatchSize, embeddingMaxAttempts } from '../../libs/config';
import { AgentCategory } from '../../libs/enums/agent-category.enum';
import { EmbeddingKind, EmbeddingStatus } from '../../libs/enums/embedding.enum';
import { EmbeddingProvider } from './embedding.provider';
import { EmbeddingSyncService } from './embedding-sync.service';
import { embeddingHash, productEmbeddingText } from './embedding-text';

type SyncModel = MockModel & { bulkWrite: jest.Mock };
type UpdateOne = {
	updateOne: { filter: Record<string, unknown>; update: { $set: Record<string, unknown> }; timestamps: boolean };
};

const product = (fields: Record<string, unknown> = {}) => ({
	_id: new Types.ObjectId(),
	productTitle: 'Voice receptionist',
	productCategory: AgentCategory.CUSTOMER_SUPPORT,
	productTags: ['phone'],
	productDesc: 'Answers calls.',
	...fields,
});
const hashOf = (doc: ReturnType<typeof product>) => embeddingHash(productEmbeddingText(doc));

describe('EmbeddingSyncService (D-52)', () => {
	let service: EmbeddingSyncService;
	let productModel: SyncModel;
	let briefModel: SyncModel;
	let provider: { model: string | null; embed: jest.Mock };

	const build = async () => {
		const moduleRef = await Test.createTestingModule({
			providers: [
				EmbeddingSyncService,
				{ provide: getModelToken('Product'), useValue: productModel },
				{ provide: getModelToken('Brief'), useValue: briefModel },
				{ provide: EmbeddingProvider, useValue: provider },
			],
		}).compile();
		service = moduleRef.get(EmbeddingSyncService);
	};

	beforeEach(async () => {
		productModel = Object.assign(createMockModel(), { bulkWrite: jest.fn().mockResolvedValue({}) });
		briefModel = Object.assign(createMockModel(), { bulkWrite: jest.fn().mockResolvedValue({}) });
		provider = {
			model: 'voyage-4-lite',
			embed: jest.fn((texts: string[]) => Promise.resolve(texts.map((_, i) => [i, i]))),
		};
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
		await build();
	});

	afterEach(() => jest.restoreAllMocks());

	const writtenOps = (model: SyncModel) => model.bulkWrite.mock.calls.flatMap(([ops]) => ops as UpdateOne[]);

	describe('syncOne', () => {
		it('embeds a new product and writes the vector compare-and-set on its text, without touching updatedAt', async () => {
			const doc = product();
			productModel.resolve('findOne', doc);

			const report = await service.syncOne(EmbeddingKind.PRODUCT, doc._id);

			expect(report).toEqual({ embedded: 1, unchanged: 0, failed: 0 });
			expect(productModel.findOne.mock.calls[0][0]).toEqual({ _id: doc._id, productStatus: { $ne: 'DELETE' } });
			expect(provider.embed).toHaveBeenCalledWith(
				[expect.stringContaining('Title: Voice receptionist')],
				'document',
				15_000,
			);
			const [op] = writtenOps(productModel);
			expect(op.updateOne.filter).toEqual({
				_id: doc._id,
				productTitle: doc.productTitle,
				productCategory: doc.productCategory,
				productTags: doc.productTags,
				productDesc: doc.productDesc,
			});
			expect(op.updateOne.update.$set).toMatchObject({
				embedding: [0, 0],
				embeddingHash: hashOf(doc),
				embeddingModel: 'voyage-4-lite',
				embeddingStatus: EmbeddingStatus.READY,
				embeddingAttempts: 0,
			});
			expect(op.updateOne.timestamps).toBe(false);
		});

		it('a missing field is matched as missing (null), so the write still finds the document', async () => {
			const doc = product({ productTags: undefined });
			productModel.resolve('findOne', doc);
			await service.syncOne(EmbeddingKind.PRODUCT, doc._id);
			expect(writtenOps(productModel)[0].updateOne.filter.productTags).toBeNull();
		});

		it('never sends the same text twice: a current vector is only marked READY', async () => {
			const doc = product();
			productModel.resolve('findOne', {
				...doc,
				embeddingHash: hashOf(doc),
				embeddingModel: 'voyage-4-lite',
				embeddingStatus: EmbeddingStatus.PENDING,
			});

			const report = await service.syncOne(EmbeddingKind.PRODUCT, doc._id);

			expect(report).toEqual({ embedded: 0, unchanged: 1, failed: 0 });
			expect(provider.embed).not.toHaveBeenCalled();
			expect(writtenOps(productModel)[0].updateOne.update).toEqual({
				$set: { embeddingStatus: EmbeddingStatus.READY, embeddingAttempts: 0 },
			});
		});

		it('a READY document with a current vector is left alone', async () => {
			const doc = product();
			productModel.resolve('findOne', {
				...doc,
				embeddingHash: hashOf(doc),
				embeddingModel: 'voyage-4-lite',
				embeddingStatus: EmbeddingStatus.READY,
			});
			await service.syncOne(EmbeddingKind.PRODUCT, doc._id);
			expect(provider.embed).not.toHaveBeenCalled();
			expect(productModel.bulkWrite).not.toHaveBeenCalled();
		});

		it('another model re-embeds the same text', async () => {
			const doc = product();
			productModel.resolve('findOne', {
				...doc,
				embeddingHash: hashOf(doc),
				embeddingModel: 'voyage-3.5-lite',
				embeddingStatus: EmbeddingStatus.READY,
			});
			await service.syncOne(EmbeddingKind.PRODUCT, doc._id);
			expect(provider.embed).toHaveBeenCalledTimes(1);
		});

		it('a provider failure marks it FAILED and counts the attempt; nothing is thrown', async () => {
			const doc = product();
			productModel.resolve('findOne', doc);
			provider.embed.mockRejectedValueOnce(new Error('Voyage 500: down'));

			const report = await service.syncOne(EmbeddingKind.PRODUCT, doc._id);

			expect(report).toEqual({ embedded: 0, unchanged: 0, failed: 1 });
			expect(productModel.updateMany).toHaveBeenCalledWith(
				{ _id: { $in: [doc._id] } },
				{ $set: { embeddingStatus: EmbeddingStatus.FAILED }, $inc: { embeddingAttempts: 1 } },
				{ timestamps: false },
			);
			expect(productModel.bulkWrite).not.toHaveBeenCalled();
		});

		it('does nothing without a provider: the document stays PENDING for later', async () => {
			provider.model = null;
			await build();
			const doc = product();
			productModel.resolve('findOne', doc);
			await expect(service.syncOne(EmbeddingKind.PRODUCT, doc._id)).resolves.toEqual({
				embedded: 0,
				unchanged: 0,
				failed: 0,
			});
			expect(provider.embed).not.toHaveBeenCalled();
		});

		it('a deleted or missing document is skipped', async () => {
			await service.syncOne(EmbeddingKind.BRIEF, new Types.ObjectId());
			expect(briefModel.findOne.mock.calls[0][0]).toMatchObject({ briefStatus: { $ne: 'DELETE' } });
			expect(provider.embed).not.toHaveBeenCalled();
		});
	});

	describe('syncPending (the reconcile job)', () => {
		// a find with nothing queued answers null in the mock; the real one answers []
		const nothingMore = (model: SyncModel) => {
			for (let i = 0; i < 5; i++) model.resolve('find', []);
		};

		it('finds live documents not READY or of another model, below the attempt limit, in _id order', async () => {
			nothingMore(productModel);
			nothingMore(briefModel);
			await service.syncPending();
			expect(productModel.find.mock.calls[0][0]).toEqual({
				productStatus: { $ne: 'DELETE' },
				embeddingAttempts: { $not: { $gte: embeddingMaxAttempts } },
				$or: [{ embeddingStatus: { $ne: EmbeddingStatus.READY } }, { embeddingModel: { $ne: 'voyage-4-lite' } }],
			});
			expect(briefModel.find).toHaveBeenCalledTimes(1);
		});

		it('walks full batches forward by _id and stops after a short one', async () => {
			const full = Array.from({ length: embeddingBatchSize }, () => product());
			const short = [product()];
			productModel.resolve('find', full).resolve('find', short);
			nothingMore(briefModel);

			const reports = await service.syncPending();

			expect(reports[EmbeddingKind.PRODUCT].embedded).toBe(embeddingBatchSize + 1);
			expect(productModel.find).toHaveBeenCalledTimes(2);
			expect(productModel.find.mock.calls[1][0]).toMatchObject({ _id: { $gt: full[full.length - 1]._id } });
		});

		it('stops a kind when the provider refuses a whole batch', async () => {
			provider.embed.mockRejectedValue(new Error('Voyage 401'));
			productModel.resolve(
				'find',
				Array.from({ length: embeddingBatchSize }, () => product()),
			);

			nothingMore(briefModel);
			const reports = await service.syncPending();

			expect(reports[EmbeddingKind.PRODUCT].failed).toBe(embeddingBatchSize);
			expect(productModel.find).toHaveBeenCalledTimes(1);
		});

		it('does nothing without a provider', async () => {
			provider.model = null;
			await build();
			await service.syncPending();
			expect(productModel.find).not.toHaveBeenCalled();
		});
	});
});
