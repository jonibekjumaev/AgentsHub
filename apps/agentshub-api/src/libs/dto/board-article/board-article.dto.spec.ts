import type { ClassConstructor } from 'class-transformer';
import { Types } from 'mongoose';
import { invalidFields } from '../../../../test/utils/validate-dto';
import { BoardArticleCategory, BoardArticleStatus } from '../../enums/board-article.enum';
import { BoardArticleInput, BoardArticlesInquiry } from './board-article.input';
import { BoardArticleUpdate } from './board-article.update';

const update = { _id: new Types.ObjectId().toHexString() };

describe('BoardArticleUpdate', () => {
	it('accepts an update with every field left out', async () => {
		expect(await invalidFields(BoardArticleUpdate, update)).toEqual([]);
	});

	it('rejects a malformed _id (B18)', async () => {
		expect(await invalidFields(BoardArticleUpdate, { _id: 'abc' })).toEqual(['_id']);
	});

	it.each(['articleStatus', 'articleTitle', 'articleContent'])('rejects null for %s (B11)', async (field) => {
		expect(await invalidFields(BoardArticleUpdate, { ...update, [field]: null })).toEqual([field]);
	});

	it('accepts null for articleImage: removes the image', async () => {
		expect(await invalidFields(BoardArticleUpdate, { ...update, articleImage: null })).toEqual([]);
	});

	it('rejects an unknown articleStatus and accepts DELETE', async () => {
		expect(await invalidFields(BoardArticleUpdate, { ...update, articleStatus: 'GONE' })).toEqual(['articleStatus']);
		expect(await invalidFields(BoardArticleUpdate, { ...update, articleStatus: BoardArticleStatus.DELETE })).toEqual(
			[],
		);
	});
});

describe('articleContent is 3–3000 characters, articleTitle stays 3–50 (D-35)', () => {
	const article = { articleCategory: BoardArticleCategory.FREE, articleTitle: 'Hello', articleContent: 'abc' };

	it.each<[string, ClassConstructor<object>, object]>([
		['BoardArticleInput', BoardArticleInput, article],
		['BoardArticleUpdate', BoardArticleUpdate, update],
	])('%s', async (_name, cls, base) => {
		expect(await invalidFields(cls, base)).toEqual([]);
		expect(await invalidFields(cls, { ...base, articleContent: 'a'.repeat(3000) })).toEqual([]);
		expect(await invalidFields(cls, { ...base, articleContent: 'a'.repeat(3001) })).toEqual(['articleContent']);
		expect(await invalidFields(cls, { ...base, articleContent: 'ab' })).toEqual(['articleContent']);
		expect(await invalidFields(cls, { ...base, articleTitle: 'a'.repeat(50) })).toEqual([]);
		expect(await invalidFields(cls, { ...base, articleTitle: 'a'.repeat(51) })).toEqual(['articleTitle']);
	});
});

it('BoardArticleInput rejects an unknown articleCategory (Step 13: @IsEnum)', async () => {
	const article = { articleCategory: 'GOSSIP', articleTitle: 'Hello', articleContent: 'abc' };
	expect(await invalidFields(BoardArticleInput, article)).toEqual(['articleCategory']);
});

describe('BoardArticlesInquiry validates its nested search (B16)', () => {
	const inquiry = { page: 1, limit: 10 };

	it('rejects a 101-character search.text and accepts 100', async () => {
		expect(await invalidFields(BoardArticlesInquiry, { ...inquiry, search: { text: 'a'.repeat(101) } })).toEqual([
			'search.text',
		]);
		expect(await invalidFields(BoardArticlesInquiry, { ...inquiry, search: { text: 'a'.repeat(100) } })).toEqual([]);
	});

	it('rejects a malformed search.memberId', async () => {
		expect(await invalidFields(BoardArticlesInquiry, { ...inquiry, search: { memberId: 'abc' } })).toEqual([
			'search.memberId',
		]);
	});
});
