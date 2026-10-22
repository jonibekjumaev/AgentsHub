import { Types } from 'mongoose';
import { LikeGroup } from '../../libs/enums/like.enum';
import { withMeLiked } from './like.service';

// Step 13a item 4: likeTargetProduct / likeTargetMember / likeTargetBoardArticle return meLiked for the caller
describe('withMeLiked', () => {
	const input = { memberId: new Types.ObjectId(), likeRefId: new Types.ObjectId(), likeGroup: LikeGroup.ARTICLE };

	it('+1 (liked): meLiked has the caller', () => {
		expect(withMeLiked({ articleLikes: 1 }, input, 1)).toEqual({
			articleLikes: 1,
			meLiked: [{ memberId: input.memberId, likeRefId: input.likeRefId, myFavorite: true }],
		});
	});

	it('-1 (unliked): meLiked is empty', () => {
		expect(withMeLiked({ articleLikes: 0 }, input, -1)).toEqual({ articleLikes: 0, meLiked: [] });
	});

	it('a Mongoose document is turned into a plain object first (a document drops unknown keys)', () => {
		const document = { toObject: () => ({ _id: input.likeRefId, articleLikes: 2 }), $isNew: false };
		expect(withMeLiked(document, input, 1)).toEqual({
			_id: input.likeRefId,
			articleLikes: 2,
			meLiked: [{ memberId: input.memberId, likeRefId: input.likeRefId, myFavorite: true }],
		});
	});
});
