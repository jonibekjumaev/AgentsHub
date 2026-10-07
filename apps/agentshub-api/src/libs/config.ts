import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { ObjectId } from './types/common';

export const aviableCreatorSorts = ['createdAt', 'updatedAt', 'memberLikes', 'memberViews', 'memberRank'];
export const aviableMemberSorts = ['createdAt', 'updatedAt', 'memberLikes', 'memberViews'];

export const aviableProductSorts = [
	'createdAt',
	'updatedAt',
	'productLikes',
	'productViews',
	'productRank',
	'productPrice',
];

export const aviableBoardArticleSorts = ['createdAt', 'updatedAt', 'articleLikes', 'articleViews'];

export const availableCommentSorts = ['createdAt', 'updatedAt'];

/**  SEARCH CONFIGURATION  **/

export const searchTextMaxLength = 100;

/**  LOGGING CONFIGURATION  **/

// Fields whose values are replaced with '***' wherever they appear in logs or error text (S12, S15)
export const sensitiveLogFields = ['memberPassword', 'currentPassword', 'newPassword', 'accessToken'];

/**  PRODUCT CONFIGURATION  **/

// productDesc is the main text for semantic search later (D-18)
export const productDescMinLength = 20;
export const productDescMaxLength = 3000;
export const productDemoUrlMaxLength = 500;
export const productTagsMaxCount = 10;
export const productTagMaxLength = 30;

/**  PASSWORD CONFIGURATION (D-26)  **/

// new passwords only (signup, changePassword.newPassword); login checks only non-empty
export const passwordMinLength = 8; // characters
export const passwordMaxBytes = 72; // UTF-8 bytes: bcrypt ignores everything after the first 72 bytes

// login compares against this when the nick has no usable password, so an unknown nick takes as long as a
// wrong password (D-27). The hash of a random, discarded value; its cost (10) must match bcrypt.genSalt()'s default
export const dummyPasswordHash = '$2a$10$ban1zV0qBemKk3dwfs6JUukL9wuZ0oXIRA/J7IRJF8D6RBczjesP2';

/**  CONTACT CONFIGURATION (D-07)  **/

export const memberEmailMaxLength = 254;
// E.164: '+', country code without a leading 0, 8–15 digits in total (max 16 characters).
// One rule for memberPhone and memberWhatsapp (D-25)
export const e164PhoneRegex = /^\+[1-9]\d{7,14}$/;

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

export const validUploadTargets = ['member', 'product', 'article'];
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

// select: false on memberPassword only applies to find(), not to aggregate(), so every pipeline
// that returns members (directly or via $lookup) drops the hash with this stage (S16)
export const excludeMemberSecrets = { $project: { memberPassword: 0 } };

export const lookupMember = {
	$lookup: {
		from: 'members',
		localField: 'memberId',
		foreignField: '_id',
		pipeline: [excludeMemberSecrets],
		as: 'memberData',
	},
};

export const lookupFollowingData = {
	$lookup: {
		from: 'members',
		localField: 'followingId',
		foreignField: '_id',
		pipeline: [excludeMemberSecrets],
		as: 'followingData',
	},
};

export const lookupFollowerData = {
	$lookup: {
		from: 'members',
		localField: 'followerId',
		foreignField: '_id',
		pipeline: [excludeMemberSecrets],
		as: 'followerData',
	},
};

export const lookupFavorite = {
	$lookup: {
		from: 'members',
		localField: 'favoriteProduct.memberId',
		foreignField: '_id',
		pipeline: [excludeMemberSecrets],
		as: 'favoriteProduct.memberData',
	},
};

export const lookupVisit = {
	$lookup: {
		from: 'members',
		localField: 'visitedProduct.memberId',
		foreignField: '_id',
		pipeline: [excludeMemberSecrets],
		as: 'visitedProduct.memberData',
	},
};
