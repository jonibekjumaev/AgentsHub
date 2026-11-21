import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { ChatMessage, ChatMessages, Conversation, ConversationOffer, Conversations } from '../../libs/dto/chat/chat';
import { ConversationsAdminInquiry, MessagesInquiry, SendMessageInput } from '../../libs/dto/chat/chat.input';
import { OrdinaryInquiry } from '../../libs/dto/common.input';
import { Offer } from '../../libs/dto/offer/offer';
import { Member } from '../../libs/dto/member/member';
import { ConversationReadOnlyReason } from '../../libs/enums/chat.enum';
import { OfferStatus } from '../../libs/enums/offer.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { Message } from '../../libs/enums/common.enum';
import {
	chatMessageIntervalMs,
	chatMessageMaxLength,
	chatPreviewLength,
	excludeDeletedMember,
	excludeMemberSecrets,
	shapeInToMongoObjectId,
	unwindKeepingItem,
} from '../../libs/config';
import { describeDbError, isDuplicateKeyError } from '../../libs/utils';
import type { AuthPayload, ObjectId, T } from '../../libs/types/common';
import { effectiveOfferStatus } from '../offer/offer.rules';
import { MemberPublisher } from '../../socket/member.publisher';

/** The offer statuses a conversation can be opened on and written in (D-49). */
const writableOfferStatuses: OfferStatus[] = [OfferStatus.PENDING, OfferStatus.ACCEPTED];

type StoredConversation = Omit<
	Conversation,
	'canWrite' | 'readOnlyReason' | 'meUnread' | 'offerData' | 'briefData' | 'userData' | 'creatorData'
> & { userUnread: number; creatorUnread: number };

/** A conversation as the aggregation returns it, before the computed fields. */
type JoinedConversation = StoredConversation & {
	userData?: Member | null;
	creatorData?: Member | null;
	briefData?: Conversation['briefData'];
	offerRow?: (ConversationOffer & { expiresAt?: Date | null }) | null;
};

const lookupMemberAs = (localField: 'userId' | 'creatorId', as: string): PipelineStage.FacetPipelineStage[] => [
	{
		$lookup: {
			from: 'members',
			localField,
			foreignField: '_id',
			pipeline: [excludeDeletedMember, excludeMemberSecrets],
			as,
		},
	},
	unwindKeepingItem(`$${as}`),
];

/** What every conversation view needs: both members, the brief, the offer. */
const joinStages: PipelineStage.FacetPipelineStage[] = [
	...lookupMemberAs('userId', 'userData'),
	...lookupMemberAs('creatorId', 'creatorData'),
	{
		$lookup: {
			from: 'briefs',
			localField: 'briefId',
			foreignField: '_id',
			pipeline: [{ $project: { briefTitle: 1, briefStatus: 1 } }],
			as: 'briefData',
		},
	},
	unwindKeepingItem('$briefData'),
	{
		$lookup: {
			from: 'offers',
			localField: 'offerId',
			foreignField: '_id',
			pipeline: [{ $project: { offerStatus: 1, offerPrice: 1, offerDeliveryDays: 1, expiresAt: 1 } }],
			as: 'offerRow',
		},
	},
	unwindKeepingItem('$offerRow'),
];

/** Only its two members read a conversation; anyone else gets the same answer as a missing one (D-49). */
const memberOf = (memberId: ObjectId): T => ({ $or: [{ userId: memberId }, { creatorId: memberId }] });

/**
 * D-49: 1:1 conversations on offers. Writing goes through GraphQL only (sendMessage); the socket is told afterwards.
 * Whether a conversation takes messages is computed on every read from its offer, its members and the admin lock.
 */
@Injectable()
export class ChatService {
	constructor(
		@InjectModel('Conversation') private readonly conversationModel: Model<Conversation>,
		@InjectModel('ChatMessage') private readonly messageModel: Model<ChatMessage>,
		@InjectModel('Offer') private readonly offerModel: Model<Offer>,
		private readonly publisher: MemberPublisher,
	) {}

	/** The brief's owner opens the conversation of an offer they received. Idempotent: the same one comes back. */
	public async openConversation(viewer: AuthPayload, offerId: ObjectId): Promise<Conversation> {
		const offer = await this.offerModel.findOne({ _id: offerId, userId: viewer._id }).lean<Offer>().exec();
		if (!offer) throw new NotFoundException(Message.NO_DATA_FOUND);
		if (!writableOfferStatuses.includes(effectiveOfferStatus(offer))) {
			throw new BadRequestException(Message.CONVERSATION_NOT_ALLOWED);
		}

		try {
			await this.conversationModel
				.updateOne(
					{ offerId },
					{
						$setOnInsert: {
							offerId,
							briefId: offer.briefId,
							userId: offer.userId,
							creatorId: offer.creatorId,
							userUnread: 0,
							creatorUnread: 0,
							lockedByAdmin: false,
						},
					},
					{ upsert: true },
				)
				.exec();
		} catch (err) {
			// opened twice at the same moment: the other request created it
			if (!isDuplicateKeyError(err)) {
				console.log('Error: Service.model', describeDbError(err));
				throw new BadRequestException(Message.CREATE_FAILED);
			}
		}

		const conversation = await this.findView({ offerId, ...memberOf(viewer._id) }, viewer);
		if (!conversation) throw new InternalServerErrorException(Message.CREATE_FAILED);
		return conversation;
	}

	public async getConversation(viewer: AuthPayload, conversationId: ObjectId): Promise<Conversation> {
		const conversation = await this.findView({ _id: conversationId, ...memberOf(viewer._id) }, viewer);
		if (!conversation) throw new NotFoundException(Message.NO_DATA_FOUND);
		return conversation;
	}

	/** The conversation of an offer, for its two members; null when the owner hasn't opened one. */
	public async getOfferConversation(viewer: AuthPayload, offerId: ObjectId): Promise<Conversation | null> {
		return await this.findView({ offerId, ...memberOf(viewer._id) }, viewer);
	}

	/** The caller's conversations, latest message first (never-written ones last, newest first). */
	public async getMyConversations(viewer: AuthPayload, input: OrdinaryInquiry): Promise<Conversations> {
		return await this.aggregatePage(memberOf(viewer._id), input, viewer);
	}

	/** The sum of the caller's unread messages, for the badge. */
	public async getUnreadCount(viewer: AuthPayload): Promise<number> {
		const result = await this.conversationModel
			.aggregate<{ total: number }>([
				{ $match: memberOf(viewer._id) },
				{
					$group: {
						_id: null,
						total: {
							$sum: { $cond: [{ $eq: ['$userId', viewer._id] }, '$userUnread', '$creatorUnread'] },
						},
					},
				},
			])
			.exec();
		return result[0]?.total ?? 0;
	}

	/**
	 * A page of history, always oldest first. No cursor: the latest messages; `before`: older ones; `after`: newer
	 * ones (catching up after a dropped socket). `hasMore` is about the direction asked for.
	 */
	public async getMessages(viewer: AuthPayload, input: MessagesInquiry): Promise<ChatMessages> {
		if (input.before && input.after) throw new BadRequestException(Message.BAD_REQUEST);
		const conversationId = shapeInToMongoObjectId(input.conversationId);
		await this.assertMember(viewer, conversationId);

		const filter: T = { conversationId };
		if (input.before) filter._id = { $lt: shapeInToMongoObjectId(input.before) };
		if (input.after) filter._id = { $gt: shapeInToMongoObjectId(input.after) };
		const newestFirst = !input.after;

		const rows = await this.messageModel
			.find(filter)
			.sort({ _id: newestFirst ? -1 : 1 })
			.limit(input.limit + 1)
			.lean<ChatMessage[]>()
			.exec();
		const page = rows.slice(0, input.limit);
		return { list: newestFirst ? page.reverse() : page, hasMore: rows.length > input.limit };
	}

	/**
	 * Stores a message, then tells both members' sockets. Idempotent by clientMessageId: a retry returns the stored
	 * message. Refused when the conversation is read-only, or within a second of the sender's last message.
	 */
	public async sendMessage(viewer: AuthPayload, input: SendMessageInput): Promise<ChatMessage> {
		const conversationId = shapeInToMongoObjectId(input.conversationId);
		const messageText = input.messageText.trim();
		if (messageText.length < 1 || messageText.length > chatMessageMaxLength) {
			throw new BadRequestException(Message.INVALID_CHAT_MESSAGE);
		}

		const retry = await this.findRetry(viewer._id, input.clientMessageId);
		if (retry) return retry;

		const conversation = await this.findView({ _id: conversationId, ...memberOf(viewer._id) }, viewer);
		if (!conversation) throw new NotFoundException(Message.NO_DATA_FOUND);
		if (!conversation.canWrite) throw new BadRequestException(Message.CONVERSATION_READ_ONLY);

		const last = await this.messageModel
			.findOne({ senderId: viewer._id })
			.sort({ createdAt: -1 })
			.select('createdAt')
			.lean<Pick<ChatMessage, 'createdAt'>>()
			.exec();
		if (last && Date.now() - new Date(last.createdAt).getTime() < chatMessageIntervalMs) {
			throw new BadRequestException(Message.CHAT_RATE_LIMITED);
		}

		let message: ChatMessage;
		try {
			const created = await this.messageModel.create({
				conversationId,
				senderId: viewer._id,
				messageText,
				clientMessageId: input.clientMessageId,
			});
			message = created.toObject();
		} catch (err) {
			// the same message sent twice at once: the other request stored it
			if (isDuplicateKeyError(err)) {
				const stored = await this.findRetry(viewer._id, input.clientMessageId);
				if (stored) return stored;
			}
			console.log('Error: Service.model', describeDbError(err));
			throw new BadRequestException(Message.CREATE_FAILED);
		}

		const isUser = viewer._id.equals(conversation.userId);
		await this.conversationModel
			.updateOne(
				{ _id: conversationId },
				{
					$set: {
						lastMessageAt: message.createdAt,
						lastMessagePreview: messageText.slice(0, chatPreviewLength),
						lastSenderId: viewer._id,
					},
					$inc: { [isUser ? 'creatorUnread' : 'userUnread']: 1 },
				},
			)
			.exec();

		this.tell([conversation.userId, conversation.creatorId], 'chat:message', { conversationId, message });
		return message;
	}

	/** The caller's side is read: their unread count goes to 0; their other tabs are told (the badge). */
	public async markConversationRead(viewer: AuthPayload, conversationId: ObjectId): Promise<Conversation> {
		const stored = await this.conversationModel
			.findOne({ _id: conversationId, ...memberOf(viewer._id) })
			.select('userId')
			.lean<Pick<StoredConversation, 'userId'>>()
			.exec();
		if (!stored) throw new NotFoundException(Message.NO_DATA_FOUND);

		const side = viewer._id.equals(stored.userId) ? 'userUnread' : 'creatorUnread';
		await this.conversationModel.updateOne({ _id: conversationId }, { $set: { [side]: 0 } }).exec();
		this.tell([viewer._id], 'chat:read', { conversationId });
		return await this.getConversation(viewer, conversationId);
	}

	/** ADMIN: every conversation's metadata, latest first. Never the messages (D-49). */
	public async getConversationsByAdmin(viewer: AuthPayload, input: ConversationsAdminInquiry): Promise<Conversations> {
		const { lockedByAdmin } = input;
		const match: T =
			lockedByAdmin === undefined || lockedByAdmin === null
				? {}
				: { lockedByAdmin: lockedByAdmin ? true : { $ne: true } };
		return await this.aggregatePage(match, input, viewer);
	}

	/** ADMIN: lock or unlock a conversation; a locked one takes no messages (readOnlyReason LOCKED_BY_ADMIN). */
	public async lockConversationByAdmin(
		viewer: AuthPayload,
		conversationId: ObjectId,
		locked: boolean,
	): Promise<Conversation> {
		const result = await this.conversationModel
			.updateOne({ _id: conversationId }, { $set: { lockedByAdmin: locked } })
			.exec();
		if (!result.matchedCount) throw new NotFoundException(Message.NO_DATA_FOUND);

		const conversation = await this.findView({ _id: conversationId }, viewer);
		if (!conversation) throw new NotFoundException(Message.NO_DATA_FOUND);
		return conversation;
	}

	/** Throws NOT_FOUND unless the caller is one of the conversation's two members. */
	private async assertMember(viewer: AuthPayload, conversationId: ObjectId): Promise<void> {
		const isMember = await this.conversationModel.exists({ _id: conversationId, ...memberOf(viewer._id) }).exec();
		if (!isMember) throw new NotFoundException(Message.NO_DATA_FOUND);
	}

	private async findRetry(senderId: ObjectId, clientMessageId: string): Promise<ChatMessage | null> {
		return await this.messageModel.findOne({ senderId, clientMessageId }).lean<ChatMessage>().exec();
	}

	/** A failed push loses nothing (the message is stored; clients catch up with getMessages after): logged only. */
	private tell(memberIds: ObjectId[], event: 'chat:message' | 'chat:read', data: unknown): void {
		try {
			this.publisher.publish(memberIds, event, data);
		} catch (err) {
			console.log('Error: MemberPublisher', err instanceof Error ? err.message : err);
		}
	}

	private async findView(match: T, viewer: AuthPayload): Promise<Conversation | null> {
		const rows = await this.conversationModel
			.aggregate<JoinedConversation>([{ $match: match }, { $limit: 1 }, ...joinStages])
			.exec();
		return rows.length ? this.toView(rows[0], viewer) : null;
	}

	private async aggregatePage(match: T, input: OrdinaryInquiry, viewer: AuthPayload): Promise<Conversations> {
		const result = await this.conversationModel
			.aggregate<{ list: JoinedConversation[]; metaCounter: Conversations['metaCounter'] }>([
				{ $match: match },
				{ $sort: { lastMessageAt: -1, createdAt: -1, _id: -1 } },
				{
					$facet: {
						list: [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }, ...joinStages],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return { list: result[0].list.map((row) => this.toView(row, viewer)), metaCounter: result[0].metaCounter };
	}

	/** The computed fields: whether it takes messages and why not, the caller's unread count, the offer as seen now. */
	private toView(row: JoinedConversation, viewer: AuthPayload, now: Date = new Date()): Conversation {
		const { offerRow, userUnread, creatorUnread, ...rest } = row;
		const offerStatus = offerRow ? effectiveOfferStatus(offerRow, now) : null;
		const offerData = offerRow
			? {
					_id: offerRow._id,
					offerStatus: offerStatus as OfferStatus,
					offerPrice: offerRow.offerPrice,
					offerDeliveryDays: offerRow.offerDeliveryDays,
				}
			: null;

		let readOnlyReason: ConversationReadOnlyReason | null = null;
		if (row.lockedByAdmin) readOnlyReason = ConversationReadOnlyReason.LOCKED_BY_ADMIN;
		else if (!offerStatus || !writableOfferStatuses.includes(offerStatus)) {
			readOnlyReason = ConversationReadOnlyReason.OFFER_CLOSED;
		} else if (
			row.userData?.memberStatus !== MemberStatus.ACTIVE ||
			row.creatorData?.memberStatus !== MemberStatus.ACTIVE
		) {
			readOnlyReason = ConversationReadOnlyReason.MEMBER_UNAVAILABLE;
		}

		const isAdmin = viewer.memberType === MemberType.ADMIN;
		const isUser = viewer._id.equals(row.userId);
		return {
			...rest,
			lockedByAdmin: Boolean(row.lockedByAdmin),
			offerData,
			canWrite: readOnlyReason === null,
			readOnlyReason,
			meUnread: isAdmin ? null : isUser ? userUnread : creatorUnread,
			// messages are private (D-49): an admin sees when the last one was written, never what it says
			...(isAdmin && { lastMessagePreview: undefined }),
		};
	}
}
