import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { MemberStatus } from './enums/member.enum';
import { ProductPricing } from './enums/product.enum';
import { ObjectId } from './types/common';

export const aviableCreatorSorts = [
	'createdAt',
	'updatedAt',
	'memberLikes',
	'memberViews',
	'memberRank',
	'memberProducts',
];
export const aviableMemberSorts = ['createdAt', 'updatedAt', 'memberLikes', 'memberViews'];

export const aviableProductSorts = [
	'createdAt',
	'updatedAt',
	'productLikes',
	'productViews',
	'productRank',
	'productPrice',
];

// briefBudget / briefDeadline are optional: empty values sort last in both directions (D-04, BriefService)
export const aviableBriefSorts = ['createdAt', 'updatedAt', 'briefViews', 'briefBudget', 'briefDeadline'];

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
export const productImagesMaxCount = 10; // the client allows 10 per product (Step 13a item 8)
export const productTagMaxLength = 30;

// the pricings that have a price (D-03): the price rule and the price range filter use this list
export const paidProductPricings: ProductPricing[] = [ProductPricing.ONE_TIME, ProductPricing.SUBSCRIPTION];

/**  BRIEF CONFIGURATION  **/

export const briefTitleMinLength = 3;
export const briefTitleMaxLength = 100;
export const briefContentMinLength = 20;
export const briefContentMaxLength = 3000;

/**  TEXT LIMITS (D-35)  **/

// a comment is a short reply, a chat message a short note, an article a forum post; memberDesc is a short bio
export const commentContentMaxLength = 1000;
export const chatMessageMaxLength = 3000;
export const articleContentMinLength = 3;
export const articleContentMaxLength = 3000;
export const memberDescMaxLength = 500;

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
// graphqlUploadExpress limits in main.ts; the messages in Message.FILE_TOO_LARGE use the same numbers.
// 10 MB covers a full-resolution phone photo; what is stored is much smaller (D-41)
export const uploadMaxFileSize = 10_000_000; // bytes
export const uploadMaxFiles = 10;
/**
 * D-41: every stored image is re-encoded: at most `imageMaxSide` px on its longer side (never enlarged), WebP at
 * `imageWebpQuality`, rotated by its EXIF orientation, and without any metadata (EXIF, GPS). Applied by saveUpload.
 */
export const imageMaxSide = 1600;
export const imageWebpQuality = 80;
/**
 * Pixels sharp may decode per upload (width × height). A JPEG compresses well, so a few MB can hold a huge picture
 * (a 4.5 MB file was 10924 × 16384 = 179 MP, ~700 MB once decoded): the byte limit alone doesn't bound the memory.
 * 50 MP covers every phone and most cameras (8256 × 5504 = 45 MP).
 */
export const imageMaxInputPixels = 50_000_000;
/** The stored name of a new upload: always .webp, whatever the uploaded type (D-41). */
export const getStoredImageName = (): string => `${uuidv4()}.webp`;

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

/**
 * D-38: a DELETE member is never joined, so `memberData` / `followerData` / `followingData` is null for them and the
 * client shows "Deleted member" without a link (getMember answers 404 for them). The item itself stays: always pair
 * these lookups with `unwindKeepingItem(...)`, a plain $unwind would drop it. BLOCK members are joined as before.
 */
export const excludeDeletedMember = { $match: { memberStatus: { $ne: MemberStatus.DELETE } } };

/** $unwind of a joined member that keeps the item when the member is missing or deleted (D-38). */
export const unwindKeepingItem = (path: string) => ({ $unwind: { path, preserveNullAndEmptyArrays: true } });

export const lookupMember = {
	$lookup: {
		from: 'members',
		localField: 'memberId',
		foreignField: '_id',
		pipeline: [excludeDeletedMember, excludeMemberSecrets],
		as: 'memberData',
	},
};

export const lookupFollowingData = {
	$lookup: {
		from: 'members',
		localField: 'followingId',
		foreignField: '_id',
		pipeline: [excludeDeletedMember, excludeMemberSecrets],
		as: 'followingData',
	},
};

export const lookupFollowerData = {
	$lookup: {
		from: 'members',
		localField: 'followerId',
		foreignField: '_id',
		pipeline: [excludeDeletedMember, excludeMemberSecrets],
		as: 'followerData',
	},
};

export const lookupFavorite = {
	$lookup: {
		from: 'members',
		localField: 'favoriteProduct.memberId',
		foreignField: '_id',
		pipeline: [excludeDeletedMember, excludeMemberSecrets],
		as: 'favoriteProduct.memberData',
	},
};

export const lookupVisit = {
	$lookup: {
		from: 'members',
		localField: 'visitedProduct.memberId',
		foreignField: '_id',
		pipeline: [excludeDeletedMember, excludeMemberSecrets],
		as: 'visitedProduct.memberData',
	},
};
