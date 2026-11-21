import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, UpdateQuery } from 'mongoose';
import { Offer, Offers } from '../../libs/dto/offer/offer';
import { BriefOffersInquiry, MyOffersInquiry, OfferInput, OfferUpdate } from '../../libs/dto/offer/offer.input';
import { Brief } from '../../libs/dto/brief/brief';
import { Product } from '../../libs/dto/product/product';
import { OfferCloseReason, OfferStatus } from '../../libs/enums/offer.enum';
import { BriefStatus, visibleBriefStatuses } from '../../libs/enums/brief.enum';
import { ProductStatus } from '../../libs/enums/product.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { Message } from '../../libs/enums/common.enum';
import {
	excludeDeletedMember,
	excludeMemberSecrets,
	lookupMember,
	offerDailyLimit,
	offerExpiresAt,
	shapeInToMongoObjectId,
	unwindKeepingItem,
	withoutEmbedding,
} from '../../libs/config';
import { describeDbError, isDuplicateKeyError } from '../../libs/utils';
import type { AuthPayload, ObjectId, T } from '../../libs/types/common';
import { MemberService } from '../member/member.service';
import { NotificationService, OfferNotificationType } from '../notification/notification.service';
import { NotificationType } from '../../libs/enums/notification.enum';
import {
	assertOfferTransition,
	briefOffersDelta,
	effectiveOfferStatus,
	OfferActor,
	offerStatusMatch,
} from './offer.rules';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The creator, joined like every author: a deleted one is null (D-38), never the password hash (S16). */
const lookupCreatorData: PipelineStage.Lookup = {
	$lookup: {
		from: 'members',
		localField: 'creatorId',
		foreignField: '_id',
		pipeline: [excludeDeletedMember, excludeMemberSecrets],
		as: 'creatorData',
	},
};

/** The attached agent, only while it is ACTIVE: a paused or deleted agent is not shown (D-16). */
const lookupProductData: PipelineStage.Lookup = {
	$lookup: {
		from: 'products',
		localField: 'productId',
		foreignField: '_id',
		pipeline: [{ $match: { productStatus: ProductStatus.ACTIVE } }, withoutEmbedding],
		as: 'productData',
	},
};

/** The owner's list: whether the owner invited this offer's creator. */
const lookupInvited: PipelineStage.Lookup = {
	$lookup: {
		from: 'invites',
		let: { briefId: '$briefId', creatorId: '$creatorId' },
		pipeline: [
			{ $match: { $expr: { $and: [{ $eq: ['$briefId', '$$briefId'] }, { $eq: ['$creatorId', '$$creatorId'] }] } } },
			{ $limit: 1 },
		],
		as: 'invitedRows',
	},
};

/** D-50: what the other side hears when a PENDING offer closes. */
const closedNotification: Partial<Record<OfferStatus, OfferNotificationType>> = {
	[OfferStatus.ACCEPTED]: NotificationType.OFFER_ACCEPTED,
	[OfferStatus.DECLINED]: NotificationType.OFFER_DECLINED,
	[OfferStatus.WITHDRAWN]: NotificationType.OFFER_WITHDRAWN,
};

type StoredOffer = Offer & { offerCloseReason?: OfferCloseReason };

/**
 * D-48: offers on briefs. Every status change goes through assertOfferTransition and is written with a filter on the
 * status that was checked, so two requests at the same moment (the owner accepts while the creator withdraws) can't
 * both win: the loser matches nothing and is answered from the offer as it is now. Brief.briefOffers changes only
 * here, by the difference in counted statuses of the write that actually happened.
 */
@Injectable()
export class OfferService {
	constructor(
		@InjectModel('Offer') private readonly offerModel: Model<Offer>,
		@InjectModel('Brief') private readonly briefModel: Model<Brief>,
		@InjectModel('Product') private readonly productModel: Model<Product>,
		private readonly memberService: MemberService,
		private readonly notificationService: NotificationService,
	) {}

	/**
	 * Sends an offer, or sends the creator's offer on this brief again (after WITHDRAWN, EXPIRED, or a brief that
	 * closed and reopened). One document per creator and brief: a second one is never created.
	 */
	public async createOffer(creatorId: ObjectId, input: OfferInput, isRetry = false): Promise<Offer> {
		const briefId = shapeInToMongoObjectId(input.briefId);
		const brief = await this.findOpenBrief(briefId);
		const productId = await this.checkOfferProduct(creatorId, input.productId);
		const now = new Date();

		const existing = await this.offerModel.findOne({ briefId, creatorId }).lean<StoredOffer>().exec();
		if (!existing) await this.checkDailyLimit(creatorId, now);

		const fields = {
			userId: brief.memberId,
			offerStatus: OfferStatus.PENDING,
			offerPrice: input.offerPrice,
			offerDeliveryDays: input.offerDeliveryDays,
			offerMessage: input.offerMessage.trim(),
			sentAt: now,
			expiresAt: offerExpiresAt(now),
		};

		if (!existing) {
			try {
				const created = await this.offerModel.create({
					briefId,
					creatorId,
					...fields,
					...(productId && { productId }),
				});
				await this.changeBriefOffers(briefId, briefOffersDelta(null, OfferStatus.PENDING));
				await this.notificationService.notifyOffer(NotificationType.OFFER_RECEIVED, created);
				return created;
			} catch (err) {
				// the same creator sent twice at once (two tabs): the other request created it; answer from that one
				if (isDuplicateKeyError(err) && !isRetry) return await this.createOffer(creatorId, input, true);
				console.log('Error: Service.model', describeDbError(err));
				throw new BadRequestException(Message.CREATE_FAILED);
			}
		}

		const current = effectiveOfferStatus(existing, now);
		if (current === OfferStatus.PENDING) throw new BadRequestException(Message.OFFER_ALREADY_PENDING);
		assertOfferTransition(current, OfferStatus.PENDING, OfferActor.CREATOR, existing.offerCloseReason);
		await this.checkDailyLimit(creatorId, now);

		const update: UpdateQuery<Offer> = {
			$set: { ...fields, ...(productId && { productId }) },
			$unset: { closedAt: 1, offerCloseReason: 1, ...(!productId && { productId: 1 }) },
		};
		const result = await this.offerModel
			.findOneAndUpdate(this.unchangedSince(existing), update, { new: true })
			.lean<Offer>()
			.exec();
		if (!result) {
			// it changed between the read and the write: answer from what it is now, once
			if (!isRetry) return await this.createOffer(creatorId, input, true);
			throw new BadRequestException(Message.INVALID_OFFER_STATUS_CHANGE);
		}

		await this.changeBriefOffers(briefId, briefOffersDelta(existing.offerStatus, OfferStatus.PENDING));
		await this.notificationService.notifyOffer(NotificationType.OFFER_RECEIVED, result);
		return result;
	}

	/** Edits a PENDING offer (price, days, message, agent); restarts its expiry. productId null detaches the agent. */
	public async updateOffer(creatorId: ObjectId, input: OfferUpdate): Promise<Offer> {
		const offerId = shapeInToMongoObjectId(input._id);
		const offer = await this.offerModel.findOne({ _id: offerId, creatorId }).lean<StoredOffer>().exec();
		if (!offer) throw new NotFoundException(Message.NO_DATA_FOUND);

		const now = new Date();
		this.assertStillPending(offer, now);
		const productId = input.productId === null ? null : await this.checkOfferProduct(creatorId, input.productId);

		const set: T = { expiresAt: offerExpiresAt(now) };
		if (input.offerPrice !== undefined) set.offerPrice = input.offerPrice;
		if (input.offerDeliveryDays !== undefined) set.offerDeliveryDays = input.offerDeliveryDays;
		if (input.offerMessage !== undefined) set.offerMessage = input.offerMessage.trim();
		if (productId) set.productId = productId;

		const result = await this.offerModel
			.findOneAndUpdate(
				{ _id: offerId, creatorId, offerStatus: OfferStatus.PENDING, expiresAt: { $gt: now } },
				{ $set: set, ...(input.productId === null && { $unset: { productId: 1 } }) },
				{ new: true },
			)
			.lean<Offer>()
			.exec();
		if (!result) return await this.answerLostRace(offerId);
		return result;
	}

	public async withdrawOffer(creatorId: ObjectId, offerId: ObjectId): Promise<Offer> {
		return await this.closePendingOffer({ _id: offerId, creatorId }, OfferStatus.WITHDRAWN, OfferActor.CREATOR);
	}

	/** Several offers of one brief may be accepted (D-48); accepting doesn't close the brief. */
	public async acceptOffer(userId: ObjectId, offerId: ObjectId): Promise<Offer> {
		return await this.closePendingOffer({ _id: offerId, userId }, OfferStatus.ACCEPTED, OfferActor.OWNER);
	}

	public async declineOffer(userId: ObjectId, offerId: ObjectId): Promise<Offer> {
		return await this.closePendingOffer({ _id: offerId, userId }, OfferStatus.DECLINED, OfferActor.OWNER);
	}

	/**
	 * One offer, for its creator, the brief's owner or an admin; anyone else gets the same answer as a missing one.
	 * Only an admin sees an offer of a deleted brief (D-30).
	 */
	public async getOffer(viewer: AuthPayload, offerId: ObjectId): Promise<Offer> {
		const isAdmin = viewer.memberType === MemberType.ADMIN;
		const access: T = isAdmin ? {} : { $or: [{ creatorId: viewer._id }, { userId: viewer._id }] };

		const result = await this.offerModel
			.aggregate<Offer & { invitedRows?: unknown[] }>([
				{ $match: { _id: offerId, ...access } },
				...this.lookupBriefData(isAdmin),
				lookupCreatorData,
				unwindKeepingItem('$creatorData'),
				lookupProductData,
				unwindKeepingItem('$productData'),
			])
			.exec();
		if (!result.length) throw new NotFoundException(Message.NO_DATA_FOUND);
		return this.withEffectiveStatus(result[0]);
	}

	/** The caller's offers (a creator), latest sent first. Offers of a deleted brief are left out (D-30). */
	public async getMyOffers(creatorId: ObjectId, input: MyOffersInquiry): Promise<Offers> {
		const now = new Date();
		return await this.aggregateOffers(
			[
				{ $match: { creatorId, ...offerStatusMatch(input.search?.offerStatus, now) } },
				// before $facet, so a deleted brief's offer is not counted either
				...this.lookupBriefData(false),
			],
			input,
			[lookupProductData, unwindKeepingItem('$productData')],
			now,
		);
	}

	/** The offers on one of the caller's briefs (its owner), latest sent first, with the "invited" mark. */
	public async getBriefOffers(userId: ObjectId, input: BriefOffersInquiry): Promise<Offers> {
		const briefId = shapeInToMongoObjectId(input.search.briefId);
		const isOwnBrief = await this.briefModel
			.exists({ _id: briefId, memberId: userId, briefStatus: { $in: visibleBriefStatuses } })
			.exec();
		if (!isOwnBrief) throw new NotFoundException(Message.NO_DATA_FOUND);

		const now = new Date();
		return await this.aggregateOffers(
			[{ $match: { briefId, ...offerStatusMatch(input.search.offerStatus, now) } }],
			input,
			[
				lookupCreatorData,
				unwindKeepingItem('$creatorData'),
				lookupProductData,
				unwindKeepingItem('$productData'),
				lookupInvited,
			],
			now,
		);
	}

	/** Brief.meOffer: the creator's own offer on a brief, or null. */
	public async findOfferOf(creatorId: ObjectId, briefId: ObjectId): Promise<Offer | null> {
		const offer = await this.offerModel.findOne({ briefId, creatorId }).lean<Offer>().exec();
		return offer ? this.withEffectiveStatus(offer) : null;
	}

	/**
	 * A brief became CLOSED or DELETE: its PENDING offers become DECLINED (BRIEF_CLOSED), expired-but-not-yet-stored
	 * ones too. Returns how many changed; briefOffers drops by exactly that many.
	 */
	public async declinePendingOffersOfBrief(briefId: ObjectId): Promise<number> {
		const result = await this.offerModel
			.updateMany(
				{ briefId, offerStatus: OfferStatus.PENDING },
				{
					$set: {
						offerStatus: OfferStatus.DECLINED,
						offerCloseReason: OfferCloseReason.BRIEF_CLOSED,
						closedAt: new Date(),
					},
					$unset: { expiresAt: 1 },
				},
			)
			.exec();
		await this.changeBriefOffers(briefId, -result.modifiedCount);
		return result.modifiedCount;
	}

	/** removeBriefByAdmin: a hard-deleted brief takes its offers with it. Returns how many were removed. */
	public async removeOffersOfBrief(briefId: ObjectId): Promise<number> {
		const result = await this.offerModel.deleteMany({ briefId }).exec();
		return result.deletedCount;
	}

	/**
	 * PENDING → ACCEPTED / DECLINED / WITHDRAWN. `owner` limits the offer to its creator or the brief's owner, so a
	 * stranger's id answers NOT_FOUND. Accepting also needs the brief still OPEN and the creator not deleted (D-38).
	 */
	private async closePendingOffer(owner: T, to: OfferStatus, actor: OfferActor): Promise<Offer> {
		const offer = await this.offerModel.findOne(owner).lean<StoredOffer>().exec();
		if (!offer) throw new NotFoundException(Message.NO_DATA_FOUND);

		const now = new Date();
		this.assertStillPending(offer, now);
		assertOfferTransition(OfferStatus.PENDING, to, actor);
		if (to === OfferStatus.ACCEPTED) {
			const isBriefOpen = await this.briefModel.exists({ _id: offer.briefId, briefStatus: BriefStatus.OPEN }).exec();
			if (!isBriefOpen) throw new BadRequestException(Message.BRIEF_NOT_OPEN);
			const creator = await this.memberService.getAuthorData(offer.creatorId);
			if (!creator) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST);
		}

		const result = await this.offerModel
			.findOneAndUpdate(
				{ ...owner, offerStatus: OfferStatus.PENDING, expiresAt: { $gt: now } },
				{ $set: { offerStatus: to, closedAt: now }, $unset: { expiresAt: 1 } },
				{ new: true },
			)
			.lean<Offer>()
			.exec();
		if (!result) return await this.answerLostRace(offer._id);

		await this.changeBriefOffers(offer.briefId, briefOffersDelta(OfferStatus.PENDING, to));
		const notification = closedNotification[to];
		if (notification) await this.notificationService.notifyOffer(notification, result);
		return result;
	}

	/** Throws unless the offer is PENDING as the caller sees it: EXPIRED gets its own message. */
	private assertStillPending(offer: StoredOffer, now: Date): void {
		const current = effectiveOfferStatus(offer, now);
		if (current === OfferStatus.EXPIRED) throw new BadRequestException(Message.OFFER_EXPIRED);
		if (current !== OfferStatus.PENDING) throw new BadRequestException(Message.INVALID_OFFER_STATUS_CHANGE);
	}

	/** A conditional write matched nothing: the offer changed since it was read. Explain why from its state now. */
	private async answerLostRace(offerId: ObjectId): Promise<never> {
		const offer = await this.offerModel.findOne({ _id: offerId }).lean<StoredOffer>().exec();
		if (!offer) throw new NotFoundException(Message.NO_DATA_FOUND);
		this.assertStillPending(offer, new Date());
		// still PENDING but not matched: it was edited in between; the caller can simply try again
		throw new BadRequestException(Message.UPDATE_FAILED);
	}

	/** The filter that matches the offer only if it is still exactly as it was read (status and expiry). */
	private unchangedSince(offer: StoredOffer): T {
		return { _id: offer._id, offerStatus: offer.offerStatus, expiresAt: offer.expiresAt ?? { $exists: false } };
	}

	/** An OPEN brief to send an offer to: a missing or deleted one is NOT_FOUND (D-30), a CLOSED one BRIEF_NOT_OPEN. */
	private async findOpenBrief(briefId: ObjectId): Promise<Brief> {
		const brief = await this.briefModel.findOne({ _id: briefId }).lean<Brief>().exec();
		if (!brief || brief.briefStatus === BriefStatus.DELETE) throw new NotFoundException(Message.NO_DATA_FOUND);
		if (brief.briefStatus !== BriefStatus.OPEN) throw new BadRequestException(Message.BRIEF_NOT_OPEN);
		return brief;
	}

	/** The attached agent must be one of the creator's ACTIVE agents. Returns its id, or null when none is given. */
	private async checkOfferProduct(creatorId: ObjectId, input: ObjectId | null | undefined): Promise<ObjectId | null> {
		if (!input) return null;
		const productId = shapeInToMongoObjectId(input);
		const isOwnActive = await this.productModel
			.exists({ _id: productId, memberId: creatorId, productStatus: ProductStatus.ACTIVE })
			.exec();
		if (!isOwnActive) throw new BadRequestException(Message.INVALID_OFFER_PRODUCT);
		return productId;
	}

	/** At most offerDailyLimit offers sent or re-sent in the last 24 hours (each offer counts once, by sentAt). */
	private async checkDailyLimit(creatorId: ObjectId, now: Date): Promise<void> {
		const sentToday = await this.offerModel
			.countDocuments({ creatorId, sentAt: { $gt: new Date(now.getTime() - DAY_MS) } })
			.exec();
		if (sentToday >= offerDailyLimit) throw new BadRequestException(Message.OFFER_DAILY_LIMIT);
	}

	private async changeBriefOffers(briefId: ObjectId, delta: number): Promise<void> {
		if (!delta) return;
		await this.briefModel.updateOne({ _id: briefId }, { $inc: { briefOffers: delta } }).exec();
	}

	/** briefData with its author. `includeDeleted`: an admin also sees offers of a deleted brief. */
	private lookupBriefData(includeDeleted: boolean): PipelineStage[] {
		return [
			{
				$lookup: {
					from: 'briefs',
					localField: 'briefId',
					foreignField: '_id',
					pipeline: [
						...(includeDeleted ? [] : [{ $match: { briefStatus: { $in: visibleBriefStatuses } } }]),
						withoutEmbedding,
						lookupMember,
						unwindKeepingItem('$memberData'),
					],
					as: 'briefData',
				},
			},
			{ $unwind: '$briefData' }, // an offer whose brief is gone (or hidden) is dropped
		];
	}

	/** A page of offers, latest sent first; `pageStages` run on the page only, after $limit. */
	private async aggregateOffers(
		matchStages: PipelineStage[],
		input: { page: number; limit: number },
		pageStages: PipelineStage.FacetPipelineStage[],
		now: Date,
	): Promise<Offers> {
		const result = await this.offerModel
			.aggregate<{ list: (Offer & { invitedRows?: unknown[] })[]; metaCounter: Offers['metaCounter'] }>([
				...matchStages,
				{ $sort: { sentAt: -1, _id: -1 } },
				{
					$facet: {
						list: [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }, ...pageStages],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return {
			list: result[0].list.map((offer) => this.withEffectiveStatus(offer, now)),
			metaCounter: result[0].metaCounter,
		};
	}

	/** The offer as the caller should see it: an expired PENDING one as EXPIRED; the invited mark as a boolean. */
	private withEffectiveStatus(offer: Offer & { invitedRows?: unknown[] }, now: Date = new Date()): Offer {
		const { invitedRows, ...rest } = offer;
		const offerStatus = effectiveOfferStatus(rest, now);
		return {
			...rest,
			offerStatus,
			...(offerStatus !== OfferStatus.PENDING && { expiresAt: undefined }),
			...(invitedRows && { invited: invitedRows.length > 0 }),
		};
	}
}
