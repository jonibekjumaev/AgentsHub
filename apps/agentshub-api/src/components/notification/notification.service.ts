import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { Notification, Notifications } from '../../libs/dto/notification/notification';
import { NotificationsInquiry } from '../../libs/dto/notification/notification.input';
import { NotificationGroup, NotificationStatus, NotificationType } from '../../libs/enums/notification.enum';
import { CommentGroup } from '../../libs/enums/comment.enum';
import { Message } from '../../libs/enums/common.enum';
import {
	excludeDeletedMember,
	excludeMemberSecrets,
	notificationDescLength,
	unwindKeepingItem,
} from '../../libs/config';
import { describeDbError } from '../../libs/utils';
import type { ObjectId } from '../../libs/types/common';
import { MemberPublisher } from '../../socket/member.publisher';

/** The parts of an offer or invite a notification needs. */
export type OfferParties = { briefId: ObjectId; userId: ObjectId; creatorId: ObjectId };

export type OfferNotificationType =
	| NotificationType.OFFER_RECEIVED
	| NotificationType.OFFER_ACCEPTED
	| NotificationType.OFFER_DECLINED
	| NotificationType.OFFER_WITHDRAWN;

type NewNotification = Pick<
	Notification,
	'notificationType' | 'notificationGroup' | 'notificationTitle' | 'authorId' | 'receiverId'
> &
	Partial<Pick<Notification, 'notificationDesc' | 'productId' | 'briefId' | 'articleId'>>;

type Owned = { memberId: ObjectId };

const lookupAuthorData: PipelineStage.Lookup = {
	$lookup: {
		from: 'members',
		localField: 'authorId',
		foreignField: '_id',
		pipeline: [excludeDeletedMember, excludeMemberSecrets],
		as: 'authorData',
	},
};

/** The start of a text, on one line, at most `max` characters. */
const excerpt = (text: string, max: number): string => {
	const line = text.replace(/\s+/g, ' ').trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/**
 * D-50: notifications. Sending is best effort: the action that caused it (an offer, a comment) already happened, so a
 * failure here is logged and never turns that action into an error. Nobody is notified about their own action. Each
 * new one is pushed to the receiver's open sockets as `notification:new`; GraphQL stays the source of truth.
 */
@Injectable()
export class NotificationService {
	constructor(
		@InjectModel('Notification') private readonly notificationModel: Model<Notification>,
		@InjectModel('Brief') private readonly briefModel: Model<Owned & { briefTitle: string }>,
		@InjectModel('Product') private readonly productModel: Model<Owned & { productTitle: string }>,
		@InjectModel('BoardArticle') private readonly boardArticleModel: Model<Owned & { articleTitle: string }>,
		@InjectModel('Member') private readonly memberModel: Model<{ _id: ObjectId; memberNick: string }>,
		private readonly publisher: MemberPublisher,
	) {}

	/** OFFER_RECEIVED / OFFER_WITHDRAWN go to the brief's owner, OFFER_ACCEPTED / OFFER_DECLINED to the creator. */
	public async notifyOffer(type: OfferNotificationType, offer: OfferParties): Promise<void> {
		await this.safely(async () => {
			const toOwner = type === NotificationType.OFFER_RECEIVED || type === NotificationType.OFFER_WITHDRAWN;
			const brief = await this.briefModel.findById(offer.briefId, { briefTitle: 1 }).lean().exec();
			if (!brief) return;
			await this.send({
				notificationType: type,
				notificationGroup: NotificationGroup.BRIEF,
				notificationTitle: brief.briefTitle,
				authorId: toOwner ? offer.creatorId : offer.userId,
				receiverId: toOwner ? offer.userId : offer.creatorId,
				briefId: offer.briefId,
			});
		});
	}

	/** A new invite only (inviting again is idempotent and sends nothing). */
	public async notifyInvite(invite: OfferParties): Promise<void> {
		await this.safely(async () => {
			const brief = await this.briefModel.findById(invite.briefId, { briefTitle: 1 }).lean().exec();
			if (!brief) return;
			await this.send({
				notificationType: NotificationType.INVITE,
				notificationGroup: NotificationGroup.BRIEF,
				notificationTitle: brief.briefTitle,
				authorId: invite.userId,
				receiverId: invite.creatorId,
				briefId: invite.briefId,
			});
		});
	}

	/** To the owner of what was commented on: the agent's creator, the brief's or article's author, the member. */
	public async notifyComment(authorId: ObjectId, group: CommentGroup, refId: ObjectId, text: string): Promise<void> {
		await this.safely(async () => {
			const target = await this.commentTarget(group, refId);
			if (!target) return;
			await this.send({
				notificationType: NotificationType.COMMENT,
				notificationGroup: target.group,
				notificationTitle: target.title,
				notificationDesc: excerpt(text, notificationDescLength),
				authorId,
				receiverId: target.receiverId,
				...target.ref,
			});
		});
	}

	/** Once per follower: following, unfollowing and following again sends nothing new. */
	public async notifyFollow(followerId: ObjectId, followingId: ObjectId): Promise<void> {
		await this.safely(async () => {
			const sent = await this.notificationModel
				.exists({ notificationType: NotificationType.FOLLOW, authorId: followerId, receiverId: followingId })
				.exec();
			if (sent) return;
			const follower = await this.memberModel.findById(followerId, { memberNick: 1 }).lean().exec();
			if (!follower) return;
			await this.send({
				notificationType: NotificationType.FOLLOW,
				notificationGroup: NotificationGroup.MEMBER,
				notificationTitle: follower.memberNick,
				authorId: followerId,
				receiverId: followingId,
			});
		});
	}

	/** The caller's notifications, latest first, with who did each. */
	public async getMyNotifications(memberId: ObjectId, input: NotificationsInquiry): Promise<Notifications> {
		const { page, limit, unreadOnly } = input;
		const result = await this.notificationModel
			.aggregate<Notifications>([
				{ $match: { receiverId: memberId, ...(unreadOnly && { notificationStatus: NotificationStatus.WAIT }) } },
				{ $sort: { createdAt: -1, _id: -1 } },
				{
					$facet: {
						list: [
							{ $skip: (page - 1) * limit },
							{ $limit: limit },
							lookupAuthorData,
							unwindKeepingItem('$authorData'),
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0];
	}

	public async getUnreadCount(memberId: ObjectId): Promise<number> {
		return await this.notificationModel
			.countDocuments({ receiverId: memberId, notificationStatus: NotificationStatus.WAIT })
			.exec();
	}

	/** Someone else's id answers like a missing one. Reading one already READ changes nothing. */
	public async markNotificationRead(memberId: ObjectId, notificationId: ObjectId): Promise<Notification> {
		const result = await this.notificationModel
			.findOneAndUpdate(
				{ _id: notificationId, receiverId: memberId },
				{ $set: { notificationStatus: NotificationStatus.READ } },
				{ new: true },
			)
			.lean<Notification>()
			.exec();
		if (!result) throw new NotFoundException(Message.NO_DATA_FOUND);
		this.push(memberId, 'notification:read');
		return result;
	}

	/** Returns how many changed. The caller's other tabs are told, so their badge drops too. */
	public async markAllNotificationsRead(memberId: ObjectId): Promise<number> {
		const result = await this.notificationModel
			.updateMany(
				{ receiverId: memberId, notificationStatus: NotificationStatus.WAIT },
				{ $set: { notificationStatus: NotificationStatus.READ } },
			)
			.exec();
		if (result.modifiedCount) this.push(memberId, 'notification:read');
		return result.modifiedCount;
	}

	private async send(doc: NewNotification): Promise<void> {
		if (String(doc.authorId) === String(doc.receiverId)) return;
		const created = await this.notificationModel.create(doc);
		this.push(doc.receiverId, 'notification:new', { notificationId: String(created._id) });
	}

	private push(memberId: ObjectId, event: 'notification:new' | 'notification:read', data: object = {}): void {
		try {
			this.publisher.publish([memberId], event, data);
		} catch (err) {
			console.log('Error: MemberPublisher', err instanceof Error ? err.message : err);
		}
	}

	private async safely(run: () => Promise<void>): Promise<void> {
		try {
			await run();
		} catch (err) {
			console.log('Error: NotificationService', describeDbError(err));
		}
	}

	private async commentTarget(
		group: CommentGroup,
		refId: ObjectId,
	): Promise<{
		group: NotificationGroup;
		title: string;
		receiverId: ObjectId;
		ref: Partial<Pick<Notification, 'productId' | 'briefId' | 'articleId'>>;
	} | null> {
		switch (group) {
			case CommentGroup.PRODUCT: {
				const product = await this.productModel.findById(refId, { memberId: 1, productTitle: 1 }).lean().exec();
				return product
					? {
							group: NotificationGroup.PRODUCT,
							title: product.productTitle,
							receiverId: product.memberId,
							ref: { productId: refId },
						}
					: null;
			}
			case CommentGroup.BRIEF: {
				const brief = await this.briefModel.findById(refId, { memberId: 1, briefTitle: 1 }).lean().exec();
				return brief
					? {
							group: NotificationGroup.BRIEF,
							title: brief.briefTitle,
							receiverId: brief.memberId,
							ref: { briefId: refId },
						}
					: null;
			}
			case CommentGroup.ARTICLE: {
				const article = await this.boardArticleModel.findById(refId, { memberId: 1, articleTitle: 1 }).lean().exec();
				return article
					? {
							group: NotificationGroup.ARTICLE,
							title: article.articleTitle,
							receiverId: article.memberId,
							ref: { articleId: refId },
						}
					: null;
			}
			case CommentGroup.MEMBER: {
				const member = await this.memberModel.findById(refId, { memberNick: 1 }).lean().exec();
				return member
					? { group: NotificationGroup.MEMBER, title: member.memberNick, receiverId: refId, ref: {} }
					: null;
			}
			default:
				return null;
		}
	}
}
