import { Types } from 'mongoose';
import { BoardArticleCategory, BoardArticleStatus } from '../../../agentshub-api/src/libs/enums/board-article.enum';
import { BriefStatus } from '../../../agentshub-api/src/libs/enums/brief.enum';
import { AgentCategory } from '../../../agentshub-api/src/libs/enums/agent-category.enum';
import { CommentGroup, CommentStatus } from '../../../agentshub-api/src/libs/enums/comment.enum';
import { LikeGroup } from '../../../agentshub-api/src/libs/enums/like.enum';
import { MemberAuthType, MemberStatus, MemberType } from '../../../agentshub-api/src/libs/enums/member.enum';
import { ProductPricing, ProductStatus } from '../../../agentshub-api/src/libs/enums/product.enum';
import { ViewGroup } from '../../../agentshub-api/src/libs/enums/view.enum';

/**
 * Step 13a (B22, D-34): brings Nestar-era documents to the AgentsHub schema, so every non-null GraphQL field
 * has a value of the right type. Pure functions: `planFix(collection, doc)` says what one document needs;
 * `scripts/migrate-legacy.ts` reads the documents and writes the fixes only with `--apply`.
 */

export type LegacyDoc = Record<string, unknown> & { _id: unknown };

export type DocFix = {
	$set: Record<string, unknown>;
	$unset: Record<string, ''>;
	/** rule names, for the per-rule counts of the dry run */
	rules: string[];
	/** problems a script can't decide (e.g. a missing title): reported, never written */
	problems: string[];
};

type Rule = (doc: LegacyDoc, fix: DocFix) => void;

const isMissing = (value: unknown): boolean => value === undefined || value === null;
const isInt = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value);

/** A non-null Int counter: missing, null or not an integer → 0. */
const counter =
	(field: string): Rule =>
	(doc, fix) => {
		if (!isInt(doc[field])) {
			fix.$set[field] = 0;
			fix.rules.push(`${field} → 0`);
		}
	};

/**
 * A non-null enum: a legacy value in `map` is renamed; a missing or unknown value gets `fallback`
 * when there is a safe one, otherwise it is reported.
 */
const enumField =
	(field: string, values: Record<string, string>, map: Record<string, string> = {}, fallback?: string): Rule =>
	(doc, fix) => {
		const value = doc[field];
		const allowed = Object.values(values);
		if (typeof value === 'string' && allowed.includes(value)) return;
		if (typeof value === 'string' && map[value]) {
			fix.$set[field] = map[value];
			fix.rules.push(`${field} ${value} → ${map[value]}`);
		} else if (fallback) {
			fix.$set[field] = fallback;
			fix.rules.push(`${field} ${isMissing(value) ? 'missing' : 'invalid'} → ${fallback}`);
		} else {
			fix.problems.push(`${field} ${isMissing(value) ? 'missing' : `invalid (${String(value)})`}`);
		}
	};

/** A non-null String: missing → `fallback` when there is a safe one, otherwise reported. */
const stringField =
	(field: string, fallback?: string): Rule =>
	(doc, fix) => {
		if (typeof doc[field] === 'string') return;
		if (fallback !== undefined) {
			fix.$set[field] = fallback;
			fix.rules.push(`${field} missing → ${JSON.stringify(fallback)}`);
		} else fix.problems.push(`${field} missing`);
	};

/** A non-null reference (memberId, commentRefId): can't be guessed, only reported. */
const requiredField =
	(field: string): Rule =>
	(doc, fix) => {
		if (isMissing(doc[field])) fix.problems.push(`${field} missing`);
	};

/** createdAt / updatedAt: missing → the time in the ObjectId. */
const timestamps: Rule = (doc, fix) => {
	for (const field of ['createdAt', 'updatedAt']) {
		if (doc[field] instanceof Date) continue;
		if (doc._id instanceof Types.ObjectId) {
			fix.$set[field] = doc._id.getTimestamp();
			fix.rules.push(`${field} missing → _id time`);
		} else fix.problems.push(`${field} missing`);
	}
};

const unsetField =
	(field: string): Rule =>
	(doc, fix) => {
		if (field in doc) {
			fix.$unset[field] = '';
			fix.rules.push(`remove ${field}`);
		}
	};

/** members.memberProperties → memberProducts (Step 6 part 8 for members it missed); never overwrites a count. */
const memberProperties: Rule = (doc, fix) => {
	if (!('memberProperties' in doc)) return;
	if (!isInt(doc.memberProducts) || doc.memberProducts === 0) {
		fix.$set.memberProducts = isInt(doc.memberProperties) ? doc.memberProperties : 0;
		fix.rules.push('memberProperties → memberProducts');
	} else fix.rules.push('remove memberProperties (memberProducts already set)');
	fix.$unset.memberProperties = '';
};

/** D-03: FREE / CUSTOM have no price, ONE_TIME / SUBSCRIPTION need one > 0. Runs after productPricing. */
const productPricing: Rule = (doc, fix) => {
	const pricing = (fix.$set.productPricing ?? doc.productPricing) as string | undefined;
	const price = doc.productPrice;
	const hasPrice = typeof price === 'number' && price > 0;
	if (isMissing(pricing) || !Object.values(ProductPricing).includes(pricing as ProductPricing)) {
		const next = hasPrice ? ProductPricing.ONE_TIME : ProductPricing.CUSTOM;
		fix.$set.productPricing = next;
		fix.rules.push(`productPricing ${isMissing(pricing) ? 'missing' : 'invalid'} → ${next}`);
		if (!hasPrice && !isMissing(price)) fix.$unset.productPrice = '';
		return;
	}
	if ((pricing === ProductPricing.FREE || pricing === ProductPricing.CUSTOM) && !isMissing(price)) {
		fix.$unset.productPrice = '';
		fix.rules.push(`productPrice removed (${pricing}, D-03)`);
	} else if ((pricing === ProductPricing.ONE_TIME || pricing === ProductPricing.SUBSCRIPTION) && !hasPrice) {
		fix.problems.push(`productPrice missing for ${pricing} (D-03)`);
	}
};

const stringArray =
	(field: string): Rule =>
	(doc, fix) => {
		if (Array.isArray(doc[field])) return;
		fix.$set[field] = [];
		fix.rules.push(`${field} missing → []`);
	};

/** The rules per collection, in order. Fields follow the GraphQL output types in libs/dto. */
export const legacyRules: Record<string, Rule[]> = {
	members: [
		enumField('memberType', MemberType, { AGENT: MemberType.CREATOR }),
		enumField('memberStatus', MemberStatus, {}, MemberStatus.ACTIVE),
		enumField('memberAuthType', MemberAuthType, {}, MemberAuthType.PHONE),
		stringField('memberPhone'),
		stringField('memberNick'),
		stringField('memberImage', ''),
		memberProperties,
		...[
			'memberProducts',
			'memberBriefs',
			'memberArticles',
			'memberFollowers',
			'memberFollowings',
			'memberPoints',
			'memberLikes',
			'memberViews',
			'memberComments',
			'memberRank',
			'memberWarnings',
			'memberBlocks',
		].map(counter),
		unsetField('memberAddress'),
		timestamps,
	],
	products: [
		enumField('productCategory', AgentCategory, {}, AgentCategory.OTHER),
		// Nestar's SOLD has no AgentsHub meaning: hidden, not deleted
		enumField('productStatus', ProductStatus, { SOLD: ProductStatus.PAUSED }),
		productPricing,
		stringField('productTitle'),
		stringField('productDesc', ''),
		stringArray('productImages'),
		...['productViews', 'productLikes', 'productComments', 'productRank'].map(counter),
		requiredField('memberId'),
		timestamps,
	],
	briefs: [
		enumField('briefCategory', AgentCategory, {}, AgentCategory.OTHER),
		enumField('briefStatus', BriefStatus),
		stringField('briefTitle'),
		stringField('briefContent'),
		...['briefViews', 'briefComments'].map(counter),
		requiredField('memberId'),
		timestamps,
	],
	boardArticles: [
		enumField('articleCategory', BoardArticleCategory, {}, BoardArticleCategory.FREE),
		enumField('articleStatus', BoardArticleStatus),
		stringField('articleTitle'),
		stringField('articleContent'),
		...['articleViews', 'articleLikes', 'articleComments'].map(counter),
		requiredField('memberId'),
		timestamps,
	],
	comments: [
		enumField('commentStatus', CommentStatus, {}, CommentStatus.ACTIVE),
		enumField('commentGroup', CommentGroup, { PROPERTY: CommentGroup.PRODUCT }),
		stringField('commentContent'),
		requiredField('commentRefId'),
		requiredField('memberId'),
		timestamps,
	],
	likes: [enumField('likeGroup', LikeGroup, { PROPERTY: LikeGroup.PRODUCT })],
	views: [enumField('viewGroup', ViewGroup, { PROPERTY: ViewGroup.PRODUCT })],
};

export const legacyCollections = Object.keys(legacyRules);

/** What one document needs. An empty `rules` and `problems` means it already fits the schema. */
export const planFix = (collection: string, doc: LegacyDoc): DocFix => {
	const fix: DocFix = { $set: {}, $unset: {}, rules: [], problems: [] };
	for (const rule of legacyRules[collection] ?? []) rule(doc, fix);
	return fix;
};

/** The update for `updateOne`, or null when there is nothing to write. */
export const toUpdate = (fix: DocFix): { $set?: Record<string, unknown>; $unset?: Record<string, ''> } | null => {
	const update = {
		...(Object.keys(fix.$set).length && { $set: fix.$set }),
		...(Object.keys(fix.$unset).length && { $unset: fix.$unset }),
	};
	return Object.keys(update).length ? update : null;
};

export type CollectionReport = {
	collection: string;
	scanned: number;
	toChange: number;
	byRule: Record<string, number>;
	problems: { _id: string; problems: string[] }[];
};

/** Adds one document's fix to the per-collection report of the dry run / apply run. */
export const addToReport = (report: CollectionReport, doc: LegacyDoc, fix: DocFix): void => {
	report.scanned += 1;
	if (toUpdate(fix)) report.toChange += 1;
	for (const rule of fix.rules) {
		// "memberType AGENT → CREATOR" and "productPrice removed (FREE, D-03)" stay as they are; values never vary
		report.byRule[rule] = (report.byRule[rule] ?? 0) + 1;
	}
	if (fix.problems.length) report.problems.push({ _id: String(doc._id), problems: fix.problems });
};

export const emptyReport = (collection: string): CollectionReport => ({
	collection,
	scanned: 0,
	toChange: 0,
	byRule: {},
	problems: [],
});
