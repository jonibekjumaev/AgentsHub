import { Types } from 'mongoose';
import { invalidFields } from '../../../../test/utils/validate-dto';
import { FollowInquiry } from './follow.input';

describe('FollowInquiry validates its nested search (B16)', () => {
	const inquiry = { page: 1, limit: 10 };

	it('accepts valid ids', async () => {
		const id = new Types.ObjectId().toHexString();

		expect(await invalidFields(FollowInquiry, { ...inquiry, search: { followingId: id } })).toEqual([]);
		expect(await invalidFields(FollowInquiry, { ...inquiry, search: { followerId: id } })).toEqual([]);
	});

	it.each(['followingId', 'followerId'])('rejects a malformed %s', async (field) => {
		expect(await invalidFields(FollowInquiry, { ...inquiry, search: { [field]: 'abc' } })).toEqual([`search.${field}`]);
	});
});
