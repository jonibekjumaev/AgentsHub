import fs from 'fs';
import path from 'path';
import { ClientSession, Connection, Types } from 'mongoose';
import { BoardArticleService } from '../../apps/agentshub-api/src/components/board-article/board-article.service';
import { CommentService } from '../../apps/agentshub-api/src/components/comment/comment.service';
import { FollowService } from '../../apps/agentshub-api/src/components/follow/follow.service';
import { MemberService } from '../../apps/agentshub-api/src/components/member/member.service';
import { ProductService } from '../../apps/agentshub-api/src/components/product/product.service';
import { BoardArticleInput } from '../../apps/agentshub-api/src/libs/dto/board-article/board-article.input';
import { CommentInput } from '../../apps/agentshub-api/src/libs/dto/comment/comment.input';
import { MemberInput } from '../../apps/agentshub-api/src/libs/dto/member/member.input';
import { MemberUpdate, MemberUpdateByAdmin } from '../../apps/agentshub-api/src/libs/dto/member/member.update';
import { ProductInput } from '../../apps/agentshub-api/src/libs/dto/product/product.input';
import { ProductUpdate } from '../../apps/agentshub-api/src/libs/dto/product/product.update';
import { CommentGroup } from '../../apps/agentshub-api/src/libs/enums/comment.enum';
import { MemberStatus, MemberType } from '../../apps/agentshub-api/src/libs/enums/member.enum';
import { createAdminIfMissing } from '../create-admin';
import { createScriptContext, isProduction, requireEnv, runScript, ScriptError, validated } from '../script-utils';
import {
	seedArticleLikes,
	seedArticles,
	seedComments,
	seedFollows,
	seedImages,
	seedMemberLikes,
	seedMembers,
	seedMemberViews,
	seedNickPrefix,
	seedProductLikes,
	seedProducts,
	seedProductViews,
} from './seed-data';

type ObjectId = Types.ObjectId;

/**
 * Dev seed (D-13): deletes the previous seed data and recreates it through the API's services, so the D-03 price
 * rule, D-16 status changes and every counter behave exactly as in the API. Never runs in production, never drops
 * a collection, and never deletes or changes manual data, except for the counter fix-ups in removeSeedData().
 */
async function main(): Promise<void> {
	// ScriptsModule has loaded .env by now, so a NODE_ENV set there counts too
	if (isProduction()) throw new ScriptError('refusing to run with NODE_ENV=production');
	const env = requireEnv(['MONGODB_DEV', 'SEED_PASSWORD'] as const);
	if (env.MONGODB_DEV === process.env.MONGODB_PROD?.trim()) {
		throw new ScriptError('refusing to run: MONGODB_DEV is the same as MONGODB_PROD');
	}

	// every input is checked against the API's DTOs before anything is deleted
	const memberInputs = await Promise.all(
		seedMembers.map((member) =>
			validated(MemberInput, {
				memberNick: member.nick,
				memberPassword: env.SEED_PASSWORD,
				memberPhone: member.phone,
				memberType: member.type,
			}),
		),
	);
	const productInputs = await Promise.all(
		seedProducts.map((product) =>
			validated(ProductInput, {
				productCategory: product.category,
				productPricing: product.pricing,
				productTitle: product.title,
				productPrice: product.price,
				productDemoUrl: product.demoUrl,
				productTags: product.tags,
				productImages: product.images.map((index) => `uploads/product/${seedImages[index]}`),
				productDesc: product.desc,
			}),
		),
	);

	const { app, connection } = await createScriptContext();
	try {
		console.log(`seed: database "${connection.db?.databaseName}"`);

		const admin = await createAdminIfMissing(app, connection);
		console.log(admin.created ? `seed: admin "${admin.nick}" created` : `seed: admin "${admin.nick}" exists, skipped`);

		const removed = await removeSeedData(connection);
		console.log('seed: removed previous seed data', removed);

		copySeedImages();

		const memberService = app.get(MemberService);
		const productService = app.get(ProductService);
		const boardArticleService = app.get(BoardArticleService);
		const commentService = app.get(CommentService);
		const followService = app.get(FollowService);

		// members
		const ids = new Map<string, ObjectId>();
		const id = (nick: string): ObjectId => {
			const memberId = ids.get(nick);
			if (!memberId) throw new ScriptError(`seed-data refers to unknown member "${nick}"`);
			return memberId;
		};
		const typeOf = (nick: string): MemberType => seedMembers.find((member) => member.nick === nick)!.type;

		for (const [index, member] of seedMembers.entries()) {
			const created = await memberService.signup(memberInputs[index]);
			const memberId = created._id;
			ids.set(member.nick, memberId);

			const profile = await validated(MemberUpdate, {
				memberFullName: member.fullName,
				memberDesc: member.desc,
				memberEmail: member.email,
				memberWhatsapp: member.whatsapp,
			});
			await memberService.updateMember(memberId, profile);
		}

		// products: created ACTIVE, then paused or deleted through the owner update (D-16)
		const productIds: ObjectId[] = [];
		for (const [index, product] of seedProducts.entries()) {
			const input = productInputs[index];
			input.memberId = id(product.creator);
			const created = await productService.createProduct(input);
			productIds.push(created._id);

			if (product.status) {
				const update = await validated(ProductUpdate, { _id: String(created._id), productStatus: product.status });
				update._id = created._id;
				await productService.updateProduct(id(product.creator), update);
			}
		}

		// board articles
		const articleIds: ObjectId[] = [];
		for (const article of seedArticles) {
			const input = await validated(BoardArticleInput, {
				articleCategory: article.category,
				articleTitle: article.title,
				articleContent: article.content,
			});
			const created = await boardArticleService.createBoardArticle(id(article.author), input);
			articleIds.push(created._id);
		}

		// interactions, all before the blocked member is blocked
		for (const [follower, following] of seedFollows) await followService.subscribe(id(follower), id(following));

		for (const [nick, indexes] of seedProductViews) {
			for (const index of indexes) await productService.getProduct(id(nick), typeOf(nick), productIds[index]);
		}
		for (const [nick, indexes] of seedProductLikes) {
			for (const index of indexes) await productService.likeTargetProduct(id(nick), productIds[index]);
		}

		for (const [viewer, target] of seedMemberViews) await memberService.getMember(id(viewer), id(target));
		for (const [liker, target] of seedMemberLikes) await memberService.likeTargetMember(id(liker), id(target));

		for (const [nick, index] of seedArticleLikes) {
			await boardArticleService.getBoardArticle(id(nick), articleIds[index]);
			await boardArticleService.likeTargetBoardArticle(id(nick), articleIds[index]);
		}

		for (const comment of seedComments) {
			let commentGroup = CommentGroup.MEMBER;
			let refId: ObjectId;
			if (comment.product !== undefined) {
				commentGroup = CommentGroup.PRODUCT;
				refId = productIds[comment.product];
			} else if (comment.article !== undefined) {
				commentGroup = CommentGroup.ARTICLE;
				refId = articleIds[comment.article];
			} else {
				refId = id(comment.member!);
			}
			const input = await validated(CommentInput, {
				commentGroup,
				commentContent: comment.text,
				commentRefId: String(refId),
			});
			input.commentRefId = refId;
			await commentService.createComment(id(comment.author), input);
		}

		// blocked member: an admin update, as in production
		for (const member of seedMembers.filter((seedMember) => seedMember.blocked)) {
			const input = await validated(MemberUpdateByAdmin, {
				_id: String(id(member.nick)),
				memberStatus: MemberStatus.BLOCK,
			});
			input._id = id(member.nick);
			await memberService.updateMemberByAdmin(input);
		}

		await printSummary(connection, [...ids.values()], productIds, articleIds);
	} finally {
		await app.close();
	}
}

/**
 * Deletes every seed member (nick starts with seedNickPrefix, never an admin), their products and articles, and
 * every like, view, comment, follow and notification by them or pointing at them, in one transaction.
 *
 * Manual records are never deleted, except likes, views, comments and follows that point at seed records.
 * Manual counters are kept right: when a seed member's like, view, comment or follow on a manual target is deleted,
 * that target's counter goes down by the same amount (likes/views/comments counters live on the target), and a
 * manual member who followed a seed member gets memberFollowings −1 per deleted follow.
 */
async function removeSeedData(connection: Connection): Promise<Record<string, number>> {
	const members = await connection
		.collection('members')
		.find({ memberNick: { $regex: `^${seedNickPrefix}` }, memberType: { $ne: MemberType.ADMIN } })
		.project<{ _id: ObjectId }>({ _id: 1 })
		.toArray();
	const memberIds = members.map((member) => member._id);
	if (!memberIds.length) return {};

	const idsOf = async (collection: string): Promise<ObjectId[]> => {
		const docs = await connection
			.collection(collection)
			.find({ memberId: { $in: memberIds } })
			.project<{ _id: ObjectId }>({ _id: 1 })
			.toArray();
		return docs.map((doc) => doc._id);
	};
	const productIds = await idsOf('products');
	const articleIds = await idsOf('boardArticles');
	const seedIds = [...memberIds, ...productIds, ...articleIds];

	const counterOf: Record<string, [collection: string, prefix: string]> = {
		PRODUCT: ['products', 'product'],
		ARTICLE: ['boardArticles', 'article'],
		MEMBER: ['members', 'member'],
	};
	const removed: Record<string, number> = {};

	await connection.transaction(async (session: ClientSession) => {
		// likes, views and comments by seed members on manual targets: undo the target's counter
		const undoTargetCounters = async (collection: string, group: string, refId: string, suffix: string) => {
			const rows = await connection
				.collection(collection)
				.aggregate<{ _id: { group: string; refId: ObjectId }; count: number }>(
					[
						{ $match: { memberId: { $in: memberIds }, [refId]: { $nin: seedIds } } },
						{ $group: { _id: { group: `$${group}`, refId: `$${refId}` }, count: { $sum: 1 } } },
					],
					{ session },
				)
				.toArray();
			for (const row of rows) {
				const counter = counterOf[row._id.group];
				if (!counter) continue;
				const [targetCollection, prefix] = counter;
				await connection
					.collection(targetCollection)
					.updateOne({ _id: row._id.refId }, { $inc: { [prefix + suffix]: -row.count } }, { session });
			}
		};
		await undoTargetCounters('likes', 'likeGroup', 'likeRefId', 'Likes');
		await undoTargetCounters('views', 'viewGroup', 'viewRefId', 'Views');
		await undoTargetCounters('comments', 'commentGroup', 'commentRefId', 'Comments');

		// follows between a manual and a seed member: undo the manual member's side
		const undoFollowCounters = async (seedSide: string, manualSide: string, counter: string) => {
			const rows = await connection
				.collection('follows')
				.aggregate<{ _id: ObjectId; count: number }>(
					[
						{ $match: { [seedSide]: { $in: memberIds }, [manualSide]: { $nin: memberIds } } },
						{ $group: { _id: `$${manualSide}`, count: { $sum: 1 } } },
					],
					{ session },
				)
				.toArray();
			for (const row of rows) {
				await connection
					.collection('members')
					.updateOne({ _id: row._id }, { $inc: { [counter]: -row.count } }, { session });
			}
		};
		await undoFollowCounters('followingId', 'followerId', 'memberFollowings');
		await undoFollowCounters('followerId', 'followingId', 'memberFollowers');

		const deletes: [string, object][] = [
			['likes', { $or: [{ memberId: { $in: memberIds } }, { likeRefId: { $in: seedIds } }] }],
			['views', { $or: [{ memberId: { $in: memberIds } }, { viewRefId: { $in: seedIds } }] }],
			['comments', { $or: [{ memberId: { $in: memberIds } }, { commentRefId: { $in: seedIds } }] }],
			['follows', { $or: [{ followerId: { $in: memberIds } }, { followingId: { $in: memberIds } }] }],
			[
				'notifications',
				{
					$or: [
						{ authorId: { $in: memberIds } },
						{ receiverId: { $in: memberIds } },
						{ productId: { $in: productIds } },
						{ articleId: { $in: articleIds } },
					],
				},
			],
			['products', { _id: { $in: productIds } }],
			['boardArticles', { _id: { $in: articleIds } }],
			['members', { _id: { $in: memberIds } }],
		];
		for (const [collection, filter] of deletes) {
			const result = await connection.collection(collection).deleteMany(filter, { session });
			removed[collection] = result.deletedCount;
		}
	});

	return removed;
}

/** Copies the placeholder images into uploads/product/ (overwriting earlier seed copies; the names are fixed). */
function copySeedImages(): void {
	const target = path.resolve('uploads', 'product');
	fs.mkdirSync(target, { recursive: true });
	for (const image of seedImages) fs.copyFileSync(path.join(__dirname, 'images', image), path.join(target, image));
}

async function printSummary(
	connection: Connection,
	memberIds: ObjectId[],
	productIds: ObjectId[],
	articleIds: ObjectId[],
): Promise<void> {
	const count = (collection: string, filter: object) => connection.collection(collection).countDocuments(filter);
	const seedIds = [...memberIds, ...productIds, ...articleIds];

	const productsByStatus = await connection
		.collection('products')
		.aggregate<{ _id: string; count: number }>([
			{ $match: { _id: { $in: productIds } } },
			{ $group: { _id: '$productStatus', count: { $sum: 1 } } },
		])
		.toArray();

	console.log('seed: created', {
		members: memberIds.length,
		products: Object.fromEntries(productsByStatus.map((row) => [row._id, row.count])),
		boardArticles: articleIds.length,
		comments: await count('comments', { commentRefId: { $in: seedIds } }),
		likes: await count('likes', { likeRefId: { $in: seedIds } }),
		views: await count('views', { viewRefId: { $in: seedIds } }),
		follows: await count('follows', { followerId: { $in: memberIds } }),
	});

	const nicks = (filter: (member: (typeof seedMembers)[number]) => boolean) =>
		seedMembers
			.filter(filter)
			.map((member) => member.nick)
			.join(', ');
	console.log(`seed: creators: ${nicks((member) => member.type === MemberType.CREATOR)}`);
	console.log(`seed: users: ${nicks((member) => member.type === MemberType.USER && !member.blocked)}`);
	console.log(`seed: blocked: ${nicks((member) => !!member.blocked)}`);
	console.log('seed: every seed member logs in with SEED_PASSWORD from .env');
}

runScript('seed', main);
