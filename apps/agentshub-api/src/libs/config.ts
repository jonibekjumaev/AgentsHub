import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { ObjectId } from './types/common';

export const aviableCreatorSorts = ['createdAt', 'updatedAt', 'memberLikes', 'memberViews', 'memberRank'];
export const aviableMemberSorts = ['createdAt', 'updatedAt', 'memberLikes', 'memberViews'];

export const aviablePropertySorts = [
	'createdAt',
	'updatedAt',
	'propertyLikes',
	'propertyViews',
	'propertyRank',
	'propertyPrice',
];

export const aviableBoardArticleSorts = ['createdAt', 'updatedAt', 'articleLikes', 'articleViews'];

export const availableCommentSorts = ['createdAt', 'updatedAt'];

/**  SEARCH CONFIGURATION  **/

export const searchTextMaxLength = 100;

/**  CONTACT CONFIGURATION (D-07)  **/

export const memberEmailMaxLength = 254;
// E.164: '+', country code without a leading 0, 8–15 digits in total (max 16 characters)
export const whatsappNumberRegex = /^\+[1-9]\d{7,14}$/;

// User search text is plain text, never a regex pattern (S8)
export const escapeRegex = (text: string): string => {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**  IMAGE CONFIGURATION  **/

export const validMimeTypes = ['image/png', 'image/jpg', 'image/jpeg'];
export const getSerialForImage = (filename: string) => {
	const ext = path.parse(filename).ext;
	return uuidv4() + ext;
};

export const validUploadTargets = ['member', 'property', 'article'];
export const getUploadPath = (target: string, imageName: string): string | null => {
	if (!validUploadTargets.includes(target)) return null;

	const uploadsRoot = path.resolve('uploads');
	const resolved = path.resolve(uploadsRoot, target, imageName);
	if (!resolved.startsWith(uploadsRoot + path.sep)) return null;

	return `uploads/${target}/${imageName}`;
};

export const shapeInToMongoObjectId = (target: string | Types.ObjectId): Types.ObjectId => {
	return typeof target === 'string' ? new Types.ObjectId(target) : target;
};

export const lookupAuthMemberLiked = (memberId: ObjectId, targetRefId: string = '$_id') => {
	return {
		$lookup: {
			from: 'likes',
			let: {
				// let bu yerda tashqaridan kirib kelgan variable ni MongoDb ga tanishtiryapdi
				localLikeRefId: targetRefId,
				localMemberRefId: memberId,
				localMyFavorite: true,
			},
			pipeline: [
				{
					$match: {
						$expr: {
							// $expr: - ikki tomonlama dinamik solishtirish
							$and: [{ $eq: ['$likeRefId', '$$localLikeRefId'] }, { $eq: ['$memberId', '$$localMemberRefId'] }],
						},
					},
				},
				{
					$project: {
						_id: 0,
						memberId: 1,
						likeRefId: 1,
						myFavorite: '$$localMyFavorite',
					},
				},
			],
			as: 'meLiked',
		},
	};
};

interface LookupAuthMemberFollowed {
	followerId: ObjectId | string;
	followingId: ObjectId | string;
}

export const lookupAuthMemberFollowed = (input: LookupAuthMemberFollowed) => {
	const { followerId, followingId } = input;
	return {
		$lookup: {
			from: 'follows',
			let: {
				localFollowerId: followerId,
				localFollowingId: followingId,
				localMyFollowing: true,
			},
			pipeline: [
				{
					$match: {
						$expr: {
							$and: [{ $eq: ['$followerId', '$$localFollowerId'] }, { $eq: ['$followingId', '$$localFollowingId'] }],
						},
					},
				},
				{
					$project: {
						_id: 0,
						followerId: 1,
						followingId: 1,
						myFollowing: '$$localMyFollowing',
					},
				},
			],
			as: 'meFollowed',
		},
	};
};

export const lookupMember = {
	$lookup: {
		from: 'members',
		localField: 'memberId',
		foreignField: '_id',
		as: 'memberData',
	},
};

export const lookupFollowingData = {
	$lookup: {
		from: 'members',
		localField: 'followingId',
		foreignField: '_id',
		as: 'followingData',
	},
};

export const lookupFollowerData = {
	$lookup: {
		from: 'members',
		localField: 'followerId',
		foreignField: '_id',
		as: 'followerData',
	},
};

export const lookupFavorite = {
	$lookup: {
		from: 'members',
		localField: 'favoriteProperty.memberId',
		foreignField: '_id',
		as: 'favoriteProperty.memberData',
	},
};

export const lookupVisit = {
	$lookup: {
		from: 'members',
		localField: 'visitedProperty.memberId',
		foreignField: '_id',
		as: 'visitedProperty.memberData',
	},
};
