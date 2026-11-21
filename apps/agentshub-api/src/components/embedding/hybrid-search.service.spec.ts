import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { keywordSearchLimit } from '../../libs/config';
import { EmbeddingKind } from '../../libs/enums/embedding.enum';
import type { ObjectId } from '../../libs/types/common';
import { HybridSearchService, fuseRankings, keywordQuery } from './hybrid-search.service';
import { VectorSearchService } from './vector-search.service';

const ids = (count: number): ObjectId[] => Array.from({ length: count }, () => new Types.ObjectId());
const rows = (list: ObjectId[]) => list.map((_id) => ({ _id }));

describe('fuseRankings (D-53)', () => {
	it('ranks a document both lists agree on above the top of either list alone', () => {
		const [a, b, c, d] = ids(4);
		// a and b: 1st in one list only; c: 2nd in both
		expect(
			fuseRankings([
				[a, c],
				[b, c],
			])[0],
		).toBe(c);
		expect(
			fuseRankings([
				[a, c, d],
				[b, c],
			]),
		).toEqual([c, a, b, d]);
	});

	it('uses only the positions, and keeps the first list’s order on a tie', () => {
		const [a, b] = ids(2);
		expect(fuseRankings([[a], [b]])).toEqual([a, b]);
		expect(fuseRankings([[b], [a]])).toEqual([b, a]);
	});

	it('matches ids by value, not by object', () => {
		const a = new Types.ObjectId();
		const fused = fuseRankings([[a], [new Types.ObjectId(a.toHexString())]]);
		expect(fused).toHaveLength(1);
	});

	it('gives one list back in its own order', () => {
		const list = ids(3);
		expect(fuseRankings([list])).toEqual(list);
		expect(fuseRankings([])).toEqual([]);
	});
});

describe('keywordQuery (D-53)', () => {
	it('turns phrase quotes and leading minus signs into plain words', () => {
		expect(keywordQuery('"phone bot" -spam')).toBe('phone bot  spam');
		expect(keywordQuery('-crm')).toBe('crm');
		expect(keywordQuery('e-commerce bot')).toBe('e-commerce bot');
		expect(keywordQuery(' " - " ')).toBe('');
	});
});

describe('HybridSearchService (D-53)', () => {
	let service: HybridSearchService;
	let productModel: MockModel;
	let briefModel: MockModel;
	let vectorSearch: { rankedIds: jest.Mock };
	let logSpy: jest.SpyInstance;

	beforeEach(async () => {
		productModel = createMockModel();
		briefModel = createMockModel();
		vectorSearch = { rankedIds: jest.fn().mockResolvedValue(null) };
		logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
		const moduleRef = await Test.createTestingModule({
			providers: [
				HybridSearchService,
				{ provide: getModelToken('Product'), useValue: productModel },
				{ provide: getModelToken('Brief'), useValue: briefModel },
				{ provide: VectorSearchService, useValue: vectorSearch },
			],
		}).compile();
		service = moduleRef.get(HybridSearchService);
	});

	afterEach(() => jest.restoreAllMocks());

	it('asks the text index for the best textScore matches within the same filter', async () => {
		const keyword = ids(2);
		productModel.resolve('find', rows(keyword));

		const result = await service.rankedIds(EmbeddingKind.PRODUCT, ' "invoice" bot ', { productStatus: 'ACTIVE' });

		expect(result).toEqual(keyword);
		expect(productModel.find).toHaveBeenCalledWith(
			{ productStatus: 'ACTIVE', $text: { $search: 'invoice  bot' } },
			{ _id: 1, score: { $meta: 'textScore' } },
		);
		const query = productModel.find.mock.results[0].value as { sort: jest.Mock; limit: jest.Mock };
		expect(query.sort).toHaveBeenCalledWith({ score: { $meta: 'textScore' } });
		expect(query.limit).toHaveBeenCalledWith(keywordSearchLimit);
		expect(vectorSearch.rankedIds).toHaveBeenCalledWith(EmbeddingKind.PRODUCT, ' "invoice" bot ', {
			productStatus: 'ACTIVE',
		});
	});

	it('fuses the vector and the keyword rankings', async () => {
		const [onlyVector, both, onlyKeyword] = ids(3);
		vectorSearch.rankedIds.mockResolvedValue([onlyVector, both]);
		briefModel.resolve('find', rows([onlyKeyword, both]));

		const result = await service.rankedIds(EmbeddingKind.BRIEF, 'clinic', { briefStatus: 'OPEN' });

		expect(result).toEqual([both, onlyVector, onlyKeyword]);
		expect(productModel.find).not.toHaveBeenCalled();
	});

	it('ranks by meaning alone when the keyword side fails, and says so once', async () => {
		const vector = ids(2);
		vectorSearch.rankedIds.mockResolvedValue(vector);
		productModel.reject('find', new Error('text index required for $text query'));
		productModel.reject('find', new Error('text index required for $text query'));

		expect(await service.rankedIds(EmbeddingKind.PRODUCT, 'bot', {})).toEqual(vector);
		expect(await service.rankedIds(EmbeddingKind.PRODUCT, 'bot', {})).toEqual(vector);
		expect(logSpy).toHaveBeenCalledTimes(1);
	});

	it('answers null when neither side can, so the lists fall back to the title match', async () => {
		productModel.reject('find', new Error('no text index'));
		expect(await service.rankedIds(EmbeddingKind.PRODUCT, 'bot', {})).toBeNull();
	});

	it('does not query the text index for a text with no words left', async () => {
		expect(await service.rankedIds(EmbeddingKind.PRODUCT, ' "-" ', {})).toBeNull();
		expect(productModel.find).not.toHaveBeenCalled();
	});
});
