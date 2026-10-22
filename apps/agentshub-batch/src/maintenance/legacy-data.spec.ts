import { Types } from 'mongoose';
import { addToReport, emptyReport, legacyCollections, planFix, toUpdate } from './legacy-data';

const _id = new Types.ObjectId();

/** A copy of `doc` without `keys` (a legacy document missing those fields) */
const omit = <D extends object>(doc: D, ...keys: (keyof D)[]): Partial<D> & { _id: unknown } =>
	Object.fromEntries(Object.entries(doc).filter(([key]) => !keys.includes(key as keyof D))) as Partial<D> & {
		_id: unknown;
	};
const now = new Date('2026-10-01T00:00:00Z');

const validMember = {
	_id,
	memberType: 'CREATOR',
	memberStatus: 'ACTIVE',
	memberAuthType: 'PHONE',
	memberPhone: '+998901234567',
	memberNick: 'rich',
	memberImage: '',
	memberProducts: 1,
	memberBriefs: 0,
	memberArticles: 0,
	memberFollowers: 0,
	memberFollowings: 0,
	memberPoints: 0,
	memberLikes: 0,
	memberViews: 0,
	memberComments: 0,
	memberRank: 0,
	memberWarnings: 0,
	memberBlocks: 0,
	createdAt: now,
	updatedAt: now,
};

const validProduct = {
	_id,
	productCategory: 'SALES',
	productStatus: 'ACTIVE',
	productPricing: 'ONE_TIME',
	productPrice: 10,
	productTitle: 'Bot',
	productDesc: 'desc',
	productImages: [],
	productViews: 0,
	productLikes: 0,
	productComments: 0,
	productRank: 0,
	memberId: new Types.ObjectId(),
	createdAt: now,
	updatedAt: now,
};

describe('legacy data migration planner (B22, D-34)', () => {
	it('covers the collections the API returns non-null fields from', () => {
		expect(legacyCollections).toEqual(['members', 'products', 'briefs', 'boardArticles', 'comments', 'likes', 'views']);
	});

	describe('members', () => {
		it('a valid AgentsHub member needs nothing', () => {
			const fix = planFix('members', validMember);
			expect(fix.rules).toEqual([]);
			expect(fix.problems).toEqual([]);
			expect(toUpdate(fix)).toBeNull();
		});

		it('the crash case: memberType AGENT → CREATOR and missing memberBriefs → 0', () => {
			const fix = planFix('members', { ...omit(validMember, 'memberBriefs'), memberType: 'AGENT' });
			expect(toUpdate(fix)).toEqual({ $set: { memberType: 'CREATOR', memberBriefs: 0 } });
			expect(fix.rules).toEqual(['memberType AGENT → CREATOR', 'memberBriefs → 0']);
		});

		it('memberProperties is renamed to memberProducts and memberAddress removed', () => {
			const fix = planFix('members', { ...validMember, memberProducts: 0, memberProperties: 3, memberAddress: 'x' });
			expect(toUpdate(fix)).toEqual({
				$set: { memberProducts: 3 },
				$unset: { memberProperties: '', memberAddress: '' },
			});
		});

		it('memberProperties never overwrites a non-zero memberProducts', () => {
			const fix = planFix('members', { ...validMember, memberProducts: 2, memberProperties: 5 });
			expect(toUpdate(fix)).toEqual({ $unset: { memberProperties: '' } });
		});

		it('missing status, auth type, image and timestamps get the schema defaults / the _id time', () => {
			const doc = omit(validMember, 'memberStatus', 'memberAuthType', 'memberImage', 'createdAt', 'updatedAt');
			expect(toUpdate(planFix('members', doc))).toEqual({
				$set: {
					memberStatus: 'ACTIVE',
					memberAuthType: 'PHONE',
					memberImage: '',
					createdAt: _id.getTimestamp(),
					updatedAt: _id.getTimestamp(),
				},
			});
		});

		it('an unknown memberType or a missing nick is reported, never guessed', () => {
			const fix = planFix('members', { ...omit(validMember, 'memberNick'), memberType: 'BROKER' });
			expect(fix.problems).toEqual(['memberType invalid (BROKER)', 'memberNick missing']);
			expect(toUpdate(fix)).toBeNull();
		});
	});

	describe('products', () => {
		it('a valid product needs nothing', () => {
			expect(toUpdate(planFix('products', validProduct))).toBeNull();
		});

		it('missing category → OTHER, SOLD → PAUSED, missing images and counters', () => {
			const doc = omit(validProduct, 'productCategory', 'productImages', 'productRank');
			expect(toUpdate(planFix('products', { ...doc, productStatus: 'SOLD' }))).toEqual({
				$set: { productCategory: 'OTHER', productStatus: 'PAUSED', productImages: [], productRank: 0 },
			});
		});

		it('D-03: missing pricing → ONE_TIME with a price, CUSTOM without one', () => {
			const doc = omit(validProduct, 'productPricing');
			expect(planFix('products', doc).$set.productPricing).toBe('ONE_TIME');
			const free = planFix('products', { ...doc, productPrice: 0 });
			expect(toUpdate(free)).toEqual({ $set: { productPricing: 'CUSTOM' }, $unset: { productPrice: '' } });
		});

		it('D-03: a price on FREE is removed, a missing price on SUBSCRIPTION is reported', () => {
			expect(toUpdate(planFix('products', { ...validProduct, productPricing: 'FREE' }))).toEqual({
				$unset: { productPrice: '' },
			});
			const doc = omit(validProduct, 'productPrice');
			expect(planFix('products', { ...doc, productPricing: 'SUBSCRIPTION' }).problems).toEqual([
				'productPrice missing for SUBSCRIPTION (D-03)',
			]);
		});
	});

	it('comments, likes and views: PROPERTY → PRODUCT', () => {
		const comment = {
			_id,
			commentStatus: 'ACTIVE',
			commentGroup: 'PROPERTY',
			commentContent: 'hi',
			commentRefId: _id,
			memberId: _id,
			createdAt: now,
			updatedAt: now,
		};
		expect(toUpdate(planFix('comments', comment))).toEqual({ $set: { commentGroup: 'PRODUCT' } });
		expect(toUpdate(planFix('likes', { _id, likeGroup: 'PROPERTY' }))).toEqual({ $set: { likeGroup: 'PRODUCT' } });
		expect(toUpdate(planFix('views', { _id, viewGroup: 'PROPERTY' }))).toEqual({ $set: { viewGroup: 'PRODUCT' } });
	});

	it('the report counts documents per rule and lists problems by _id', () => {
		const report = emptyReport('members');
		addToReport(report, validMember, planFix('members', validMember));
		const agent = { ...validMember, memberType: 'AGENT' };
		addToReport(report, agent, planFix('members', agent));
		const broken = { ...validMember, memberType: 'X' };
		addToReport(report, broken, planFix('members', broken));
		expect(report).toEqual({
			collection: 'members',
			scanned: 3,
			toChange: 1,
			byRule: { 'memberType AGENT → CREATOR': 1 },
			problems: [{ _id: String(_id), problems: ['memberType invalid (X)'] }],
		});
	});
});
