import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import {
	queryEmbeddingTimeoutMs,
	vectorSearchCandidates,
	vectorSearchLimit,
	vectorSearchMinScore,
} from '../../libs/config';
import { EmbeddingKind } from '../../libs/enums/embedding.enum';
import { EmbeddingProvider } from './embedding.provider';
import { VectorSearchService } from './vector-search.service';

describe('VectorSearchService (D-52)', () => {
	let service: VectorSearchService;
	let productModel: MockModel;
	let briefModel: MockModel;
	let provider: { model: string | null; embed: jest.Mock };
	let logSpy: jest.SpyInstance;

	const build = async () => {
		const moduleRef = await Test.createTestingModule({
			providers: [
				VectorSearchService,
				{ provide: getModelToken('Product'), useValue: productModel },
				{ provide: getModelToken('Brief'), useValue: briefModel },
				{ provide: EmbeddingProvider, useValue: provider },
			],
		}).compile();
		service = moduleRef.get(VectorSearchService);
	};

	beforeEach(async () => {
		productModel = createMockModel();
		briefModel = createMockModel();
		provider = { model: 'voyage-4-lite', embed: jest.fn().mockResolvedValue([[0.1, 0.2]]) };
		logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
		await build();
	});

	afterEach(() => jest.restoreAllMocks());

	it('asks the collection’s index for the closest documents and keeps those scoring at least the minimum, best first', async () => {
		const [best, good, weak] = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
		productModel.resolve('aggregate', [
			{ _id: best, score: 0.9 },
			{ _id: good, score: vectorSearchMinScore },
			{ _id: weak, score: vectorSearchMinScore - 0.01 },
		]);

		const ids = await service.rankedIds(EmbeddingKind.PRODUCT, 'Phone  Bot', { productStatus: 'ACTIVE' });

		expect(ids).toEqual([best, good]);
		expect(provider.embed).toHaveBeenCalledWith(['phone bot'], 'query', queryEmbeddingTimeoutMs);
		expect(productModel.aggregate.mock.calls[0][0]).toEqual([
			{
				$vectorSearch: {
					index: 'product_embedding',
					path: 'embedding',
					queryVector: [0.1, 0.2],
					numCandidates: vectorSearchCandidates,
					limit: vectorSearchLimit,
					filter: { productStatus: 'ACTIVE' },
				},
			},
			{ $project: { _id: 1, score: { $meta: 'vectorSearchScore' } } },
		]);
	});

	it('briefs use their own index', async () => {
		briefModel.resolve('aggregate', []);
		await service.rankedIds(EmbeddingKind.BRIEF, 'bot', { briefStatus: 'OPEN' });
		const [first] = briefModel.aggregate.mock.calls[0][0] as Array<{ $vectorSearch: { index: string } }>;
		expect(first.$vectorSearch.index).toBe('brief_embedding');
	});

	it('embeds the same search once (case and spacing aside) while it is cached', async () => {
		productModel.resolve('aggregate', []).resolve('aggregate', []);
		await service.rankedIds(EmbeddingKind.PRODUCT, 'Phone bot', {});
		await service.rankedIds(EmbeddingKind.PRODUCT, ' phone   BOT ', {});
		expect(provider.embed).toHaveBeenCalledTimes(1);
		expect(productModel.aggregate).toHaveBeenCalledTimes(2);
	});

	it('answers null (keyword fallback) without a provider, a blank text, a failed query vector or a failed search', async () => {
		provider.embed.mockRejectedValueOnce(new Error('timeout'));
		await expect(service.rankedIds(EmbeddingKind.PRODUCT, 'a', {})).resolves.toBeNull();
		await expect(service.rankedIds(EmbeddingKind.PRODUCT, '   ', {})).resolves.toBeNull();

		productModel.reject('aggregate', new Error('$vectorSearch is not allowed')).reject('aggregate', new Error('again'));
		await expect(service.rankedIds(EmbeddingKind.PRODUCT, 'b', {})).resolves.toBeNull();
		await expect(service.rankedIds(EmbeddingKind.PRODUCT, 'c', {})).resolves.toBeNull();
		// the missing index is reported once, not on every search
		expect(
			logSpy.mock.calls.filter(([message]) => String(message).startsWith('Vector search unavailable')),
		).toHaveLength(1);

		provider.model = null;
		await build();
		await expect(service.rankedIds(EmbeddingKind.PRODUCT, 'd', {})).resolves.toBeNull();
	});
});
