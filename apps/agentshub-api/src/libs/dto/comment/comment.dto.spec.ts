import { Types } from 'mongoose';
import { invalidFields } from '../../../../test/utils/validate-dto';
import { CommentGroup, CommentStatus } from '../../enums/comment.enum';
import { CommentInput, CommentsInquiry } from './comment.input';
import { CommentUpdate } from './comment.update';

const objectId = () => new Types.ObjectId().toHexString();

describe('CommentInput', () => {
	const comment = { commentGroup: CommentGroup.PRODUCT, commentContent: 'Nice agent', commentRefId: objectId() };

	it('accepts a comment of 1–1000 characters (D-35)', async () => {
		expect(await invalidFields(CommentInput, comment)).toEqual([]);
		expect(await invalidFields(CommentInput, { ...comment, commentContent: 'a'.repeat(1000) })).toEqual([]);
	});

	it('rejects an unknown commentGroup, e.g. the Nestar PROPERTY (Step 13: @IsEnum)', async () => {
		expect(await invalidFields(CommentInput, { ...comment, commentGroup: 'PROPERTY' })).toEqual(['commentGroup']);
	});

	it.each(['', 'a'.repeat(1001)])('rejects commentContent of length %# (D-35)', async (commentContent) => {
		expect(await invalidFields(CommentInput, { ...comment, commentContent })).toEqual(['commentContent']);
	});
});

describe('CommentUpdate', () => {
	const update = { _id: objectId() };

	it('rejects a malformed _id (B18)', async () => {
		expect(await invalidFields(CommentUpdate, { _id: 'abc' })).toEqual(['_id']);
	});

	it.each(['commentStatus', 'commentContent'])('rejects null for %s (B11)', async (field) => {
		expect(await invalidFields(CommentUpdate, { ...update, [field]: null })).toEqual([field]);
	});

	it('commentContent is 1–1000 characters, as on create (D-35)', async () => {
		expect(await invalidFields(CommentUpdate, { ...update, commentContent: 'a'.repeat(1000) })).toEqual([]);
		expect(await invalidFields(CommentUpdate, { ...update, commentContent: 'a'.repeat(1001) })).toEqual([
			'commentContent',
		]);
		expect(await invalidFields(CommentUpdate, { ...update, commentContent: '' })).toEqual(['commentContent']);
	});

	it('accepts DELETE, the owner delete of B19', async () => {
		expect(await invalidFields(CommentUpdate, { ...update, commentStatus: CommentStatus.DELETE })).toEqual([]);
	});
});

describe('CommentsInquiry validates its nested search (B16)', () => {
	const inquiry = { page: 1, limit: 10 };

	it('accepts a valid target', async () => {
		const search = { commentRefId: objectId(), commentGroup: CommentGroup.BRIEF };

		expect(await invalidFields(CommentsInquiry, { ...inquiry, search })).toEqual([]);
	});

	it.each(['abc', ''])('rejects the commentRefId %p', async (commentRefId) => {
		const search = { commentRefId, commentGroup: CommentGroup.PRODUCT };

		expect(await invalidFields(CommentsInquiry, { ...inquiry, search })).toEqual(['search.commentRefId']);
	});

	it('requires commentGroup: comments follow the target visibility (D-16)', async () => {
		expect(await invalidFields(CommentsInquiry, { ...inquiry, search: { commentRefId: objectId() } })).toEqual([
			'search.commentGroup',
		]);
	});
});
