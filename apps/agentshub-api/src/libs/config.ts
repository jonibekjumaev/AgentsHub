import { PipelineStage, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { MemberStatus, MemberType } from './enums/member.enum';
import { ProductPricing } from './enums/product.enum';
import { ObjectId } from './types/common';

// D-45: memberFollowers; creatorProducts = ACTIVE agents (not memberProducts, which counts PAUSED too, D-16);
// creatorName = memberFullName, or memberNick without one, case-insensitive
export const aviableCreatorSorts = [
	'createdAt',
	'updatedAt',
	'memberLikes',
	'memberViews',
	'memberRank',
	'memberProducts',
	'memberFollowers',
	'creatorProducts',
	'creatorName',
];
export const aviableMemberSorts = ['createdAt', 'updatedAt', 'memberLikes', 'memberViews'];

// D-52: 'relevance' orders a text search by meaning; without a semantic search it falls back to createdAt
export const aviableProductSorts = [
	'relevance',
	'createdAt',
	'updatedAt',
	'productLikes',
	'productViews',
	'productRank',
	'productPrice',
];

// briefBudget / briefDeadline are optional: empty values sort last in both directions (D-04, BriefService).
// briefComments breaks ties by briefViews; briefDeadline ASC lists upcoming, then passed, then none (D-44)
export const aviableBriefSorts = [
	'relevance',
	'createdAt',
	'updatedAt',
	'briefViews',
	'briefComments',
	'briefBudget',
	'briefDeadline',
];

/** D-42: "Who viewed your profile" lists the visits of the last N days (each visit refreshes the view's updatedAt, B24). */
export const profileVisitorsWindowDays = 90;

export const aviableBoardArticleSorts = ['createdAt', 'updatedAt', 'articleLikes', 'articleViews', 'articleComments'];

/** D-46: how many writers the community sidebar shows ("Active writers") */
export const communityTopWritersLimit = 5;

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

/** D-47: the members who save briefs. An ADMIN moderates and has no library (D-40 principle). */
export const briefSaverTypes: MemberType[] = [MemberType.USER, MemberType.CREATOR];
export const canSaveBriefs = (memberType: MemberType | null | undefined): boolean =>
	!!memberType && briefSaverTypes.includes(memberType);

/**  OFFER CONFIGURATION (D-48)  **/

// a PENDING offer expires this many days after it was last sent or edited
export const offerExpiryDays = 14;
// offers sent or re-sent by one creator, invites sent by one user, in the last 24 hours
export const offerDailyLimit = 20;
export const inviteDailyLimit = 20;
export const offerMessageMinLength = 20; // after trimming
export const offerMessageMaxLength = 2000;
export const offerDeliveryDaysMin = 1;
export const offerDeliveryDaysMax = 365;

/** The expiry of an offer sent or edited at `from` (D-48). */
export const offerExpiresAt = (from: Date): Date => new Date(from.getTime() + offerExpiryDays * 24 * 60 * 60 * 1000);

/**  LOGIN THROTTLE (D-51)  **/

// failed logins allowed per client address and nick within the window, before login answers TOO_MANY_REQUESTS
export const loginFailureLimit = 10;
export const loginFailureWindowMs = 15 * 60 * 1000;
// the throttle forgets the oldest keys beyond this many (memory bound under a spray of nicks)
export const loginThrottleMaxKeys = 10_000;

/**  WEBSOCKET (D-51)  **/

// the largest frame a client may send: a 3000-character message (D-35) in 4-byte characters, plus its JSON wrapper.
// ws closes the socket on a bigger one (its default is 100 MiB, kept in memory while it arrives)
export const wsMaxPayloadBytes = 16 * 1024;

/**  EMBEDDINGS AND VECTOR SEARCH (D-52)  **/

// the length of every stored vector; the Atlas vectorSearch indexes are created with the same number
export const embeddingDimensions = 1024;
// texts sent in one provider request (the reconcile job and the backfill)
export const embeddingBatchSize = 64;
// a document that failed this many times is left FAILED until its text changes (then attempts start again)
export const embeddingMaxAttempts = 5;
// how long a document request may take (in the background) and how long a search waits for its query vector
export const embeddingTimeoutMs = 15_000;
export const queryEmbeddingTimeoutMs = 1_500;
// query vectors kept in memory, so the same search text costs one provider request per TTL
export const queryEmbeddingCacheSize = 500;
export const queryEmbeddingCacheTtlMs = 10 * 60 * 1000;
// the semantic candidates a list search takes from $vectorSearch (the list's other filters then apply to them),
// and how many the index examines to find them (10-20x the limit is the usual advice)
export const vectorSearchLimit = 200;
export const vectorSearchCandidates = 2_000;
// candidates below this score (vectorSearchScore, 0..1 for cosine) are not related enough to list. Tune on real data
export const vectorSearchMinScore = 0.6;
/** D-53: keyword ($text) candidates per search, best textScore first; fused with the vector ones. */
export const keywordSearchLimit = 200;
/** D-53: Reciprocal Rank Fusion constant (k in 1 / (k + rank)); 60 is the usual value, larger flattens the ranks. */
export const rankFusionK = 60;
export const productVectorIndex = 'product_embedding';
export const briefVectorIndex = 'brief_embedding';

/** Leaves the stored vector out of a pipeline's documents: nobody reads it outside the search itself (D-52). */
export const withoutEmbedding: PipelineStage.Project = { $project: { embedding: 0 } };

/**  GRAPHQL (D-51)  **/

// the deepest operation the API runs (fields nested in fields); the client's deepest needs 5
export const graphqlMaxDepth = 8;

/**  LIST PAGES (D-51)  **/

// the largest `limit` any list query accepts, unless a list sets its own smaller one
export const listPageMax = 100;

/**  CHAT CONFIGURATION (D-49)  **/

// one page of a conversation's history (getMessages)
export const chatHistoryPageMax = 50;
// the last message as shown in the conversation list
export const chatPreviewLength = 140;
// at most one message per member in this window (the D-19 rule)
export const chatMessageIntervalMs = 1000;
// one page of the admin's conversation list
export const chatAdminPageMax = 100;

/**  NOTIFICATIONS (D-50)  **/

// one page of getMyNotifications
export const notificationPageMax = 50;
// a comment's text as quoted in its notification
export const notificationDescLength = 140;
// a notification is removed this long after it was created (TTL index), read or not
export const notificationTtlDays = 90;

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

/**
 * D-47: `meSaved` on each brief of a list, for the caller (`saverId`): one indexed lookup into `saves`
 * (`{ memberId, briefId }`), turned into a Boolean. Used only for a USER or CREATOR caller; others get null.
 */
export const lookupAuthMemberSaved = (saverId: ObjectId) => [
	{
		$lookup: {
			from: 'saves',
			let: { localBriefId: '$_id' },
			pipeline: [
				{ $match: { memberId: saverId, $expr: { $eq: ['$briefId', '$$localBriefId'] } } },
				{ $limit: 1 },
				{ $project: { _id: 1 } },
			],
			as: '_saved',
		},
	},
	{ $addFields: { meSaved: { $gt: [{ $size: '$_saved' }, 0] } } },
	{ $unset: '_saved' },
];

/** D-47: the author of a saved brief, as lookupFavorite does for a liked product (D-38: a deleted author is null). */
export const lookupSavedBriefAuthor = {
	$lookup: {
		from: 'members',
		localField: 'savedBrief.memberId',
		foreignField: '_id',
		pipeline: [excludeDeletedMember, excludeMemberSecrets],
		as: 'savedBrief.memberData',
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
