import { Types } from 'mongoose';
import {
	escapeRegex,
	excludeDeletedMember,
	excludeMemberSecrets,
	getUploadPath,
	lookupFavorite,
	lookupFollowerData,
	lookupFollowingData,
	lookupMember,
	lookupVisit,
	shapeInToMongoObjectId,
	unwindKeepingItem,
	validUploadTargets,
} from './config';
import { MemberStatus } from './enums/member.enum';

describe('escapeRegex (S8)', () => {
	it('makes "(" a valid pattern that matches only itself', () => {
		const pattern = new RegExp(escapeRegex('('), 'i');

		expect(pattern.test('a (b')).toBe(true);
		expect(pattern.test('ab')).toBe(false);
	});

	it('matches "a.b" literally, not as "any character"', () => {
		const pattern = new RegExp(escapeRegex('a.b'), 'i');

		expect(pattern.test('A.B')).toBe(true);
		expect(pattern.test('axb')).toBe(false);
	});

	it('escapes every regex metacharacter', () => {
		const text = '.*+?^${}()|[]\\';

		expect(new RegExp(`^${escapeRegex(text)}$`).test(text)).toBe(true);
	});
});

describe('getUploadPath (S2)', () => {
	it('returns uploads/<target>/<name> for every allowed target', () => {
		for (const target of validUploadTargets) {
			expect(getUploadPath(target, 'abc.png')).toBe(`uploads/${target}/abc.png`);
		}
	});

	it('rejects a target outside the whitelist', () => {
		expect(getUploadPath('../../tmp', 'abc.png')).toBeNull();
		expect(getUploadPath('property', 'abc.png')).toBeNull();
	});

	it('rejects a file name that leaves the target folder', () => {
		expect(getUploadPath('member', '../../../evil.png')).toBeNull();
	});
});

describe('shapeInToMongoObjectId', () => {
	it('converts a string id and returns an ObjectId unchanged', () => {
		const id = new Types.ObjectId();

		expect(shapeInToMongoObjectId(id.toHexString()).equals(id)).toBe(true);
		expect(shapeInToMongoObjectId(id)).toBe(id);
	});
});

describe('member lookups (D-38, S16)', () => {
	it.each([
		['lookupMember', lookupMember],
		['lookupFollowingData', lookupFollowingData],
		['lookupFollowerData', lookupFollowerData],
		['lookupFavorite', lookupFavorite],
		['lookupVisit', lookupVisit],
	])('%s never joins a DELETE member and never returns the password hash', (_name, lookup) => {
		expect(lookup.$lookup.from).toBe('members');
		expect(lookup.$lookup.pipeline).toEqual([excludeDeletedMember, excludeMemberSecrets]);
		expect(excludeDeletedMember).toEqual({ $match: { memberStatus: { $ne: MemberStatus.DELETE } } });
	});

	it('unwindKeepingItem keeps the item when its member is missing (a plain $unwind would drop it)', () => {
		expect(unwindKeepingItem('$memberData')).toEqual({
			$unwind: { path: '$memberData', preserveNullAndEmptyArrays: true },
		});
	});
});
