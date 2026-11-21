import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { expectHttpError } from '../../../test/utils/http-error';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { ConversationReadOnlyReason } from '../../libs/enums/chat.enum';
import { OfferStatus } from '../../libs/enums/offer.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { Message } from '../../libs/enums/common.enum';
import type { AuthPayload } from '../../libs/types/common';
import { MemberPublisher } from '../../socket/member.publisher';
import { ChatService } from './chat.service';

const ownerId = new Types.ObjectId();
const creatorId = new Types.ObjectId();
const strangerId = new Types.ObjectId();
const offerId = new Types.ObjectId();
const briefId = new Types.ObjectId();
const conversationId = new Types.ObjectId();

const owner: AuthPayload = { _id: ownerId, memberType: MemberType.USER, memberNick: 'owner' };
const creator: AuthPayload = { _id: creatorId, memberType: MemberType.CREATOR, memberNick: 'maker' };
const admin: AuthPayload = { _id: strangerId, memberType: MemberType.ADMIN, memberNick: 'admin' };

const NOW = new Date('2026-11-13T12:00:00.000Z');
const TOMORROW = new Date('2026-11-14T12:00:00.000Z');
const YESTERDAY = new Date('2026-11-12T12:00:00.000Z');

const offer = (fields: object = {}) => ({
	_id: offerId,
	briefId,
	userId: ownerId,
	creatorId,
	offerStatus: OfferStatus.PENDING,
	expiresAt: TOMORROW,
	...fields,
});

/** A conversation as the aggregation joins it */
const joined = (fields: object = {}) => ({
	_id: conversationId,
	offerId,
	briefId,
	userId: ownerId,
	creatorId,
	userUnread: 2,
	creatorUnread: 5,
	lockedByAdmin: false,
	userData: { _id: ownerId, memberStatus: MemberStatus.ACTIVE },
	creatorData: { _id: creatorId, memberStatus: MemberStatus.ACTIVE },
	briefData: { _id: briefId, briefTitle: 'Bakery bot', briefStatus: 'OPEN' },
	offerRow: {
		_id: offerId,
		offerStatus: OfferStatus.PENDING,
		offerPrice: 300,
		offerDeliveryDays: 7,
		expiresAt: TOMORROW,
	},
	...fields,
});

const sendInput = (fields: object = {}) => ({
	conversationId,
	messageText: '  When can you start?  ',
	clientMessageId: '0b6e9c2e-8a9d-4f1b-9a8e-3f1c2d4e5a6b',
	...fields,
});

describe('ChatService (D-49)', () => {
	let service: ChatService;
	let conversationModel: MockModel;
	let messageModel: MockModel;
	let offerModel: MockModel;
	let publisher: { publish: jest.Mock };

	beforeEach(async () => {
		conversationModel = createMockModel();
		messageModel = createMockModel();
		offerModel = createMockModel();
		publisher = { publish: jest.fn() };

		const moduleRef = await Test.createTestingModule({
			providers: [
				ChatService,
				{ provide: getModelToken('Conversation'), useValue: conversationModel },
				{ provide: getModelToken('ChatMessage'), useValue: messageModel },
				{ provide: getModelToken('Offer'), useValue: offerModel },
				{ provide: MemberPublisher, useValue: publisher },
			],
		}).compile();
		service = moduleRef.get(ChatService);

		jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	const firstMatch = (n = 0) => (conversationModel.aggregate.mock.calls[n][0] as object[])[0];

	describe('openConversation: only the brief owner, on a PENDING or ACCEPTED offer', () => {
		it.each([OfferStatus.PENDING, OfferStatus.ACCEPTED])(
			'a %s offer: created once (upsert), then returned',
			async (status) => {
				offerModel.resolve('findOne', offer({ offerStatus: status }));
				conversationModel.resolve('aggregate', [joined()]);

				const result = await service.openConversation(owner, offerId);

				expect(offerModel.findOne).toHaveBeenCalledWith({ _id: offerId, userId: ownerId });
				expect(conversationModel.updateOne).toHaveBeenCalledWith(
					{ offerId },
					{
						$setOnInsert: {
							offerId,
							briefId,
							userId: ownerId,
							creatorId,
							userUnread: 0,
							creatorUnread: 0,
							lockedByAdmin: false,
						},
					},
					{ upsert: true },
				);
				expect(result._id).toBe(conversationId);
			},
		);

		it("someone else's offer → NOT_FOUND", async () => {
			await expectHttpError(service.openConversation(owner, offerId), NotFoundException, Message.NO_DATA_FOUND);
			expect(conversationModel.updateOne).not.toHaveBeenCalled();
		});

		it.each([
			['DECLINED', offer({ offerStatus: OfferStatus.DECLINED })],
			['WITHDRAWN', offer({ offerStatus: OfferStatus.WITHDRAWN })],
			['past its expiry', offer({ expiresAt: YESTERDAY })],
		])('a %s offer → CONVERSATION_NOT_ALLOWED', async (_label, stored) => {
			offerModel.resolve('findOne', stored);
			await expectHttpError(
				service.openConversation(owner, offerId),
				BadRequestException,
				Message.CONVERSATION_NOT_ALLOWED,
			);
			expect(conversationModel.updateOne).not.toHaveBeenCalled();
		});

		it('opened twice at the same moment: E11000 is swallowed, the one conversation is returned', async () => {
			offerModel.resolve('findOne', offer());
			conversationModel
				.reject('updateOne', Object.assign(new Error('E11000'), { code: 11000 }))
				.resolve('aggregate', [joined()]);
			await expect(service.openConversation(owner, offerId)).resolves.toMatchObject({ _id: conversationId });
		});
	});

	describe('who reads, and what each side sees', () => {
		it('a member gets their own unread count; a stranger gets NOT_FOUND', async () => {
			conversationModel.resolve('aggregate', [joined()]).resolve('aggregate', [joined()]).resolve('aggregate', []);

			expect((await service.getConversation(owner, conversationId)).meUnread).toBe(2);
			expect((await service.getConversation(creator, conversationId)).meUnread).toBe(5);
			await expectHttpError(
				service.getConversation({ ...owner, _id: strangerId }, conversationId),
				NotFoundException,
				Message.NO_DATA_FOUND,
			);
			expect(firstMatch(2)).toEqual({
				$match: { _id: conversationId, $or: [{ userId: strangerId }, { creatorId: strangerId }] },
			});
		});

		it.each([
			['an open conversation', joined(), true, null],
			['an expired offer', joined({ offerRow: { ...joined().offerRow, expiresAt: YESTERDAY } }), false, 'OFFER_CLOSED'],
			[
				'a withdrawn offer',
				joined({ offerRow: { ...joined().offerRow, offerStatus: OfferStatus.WITHDRAWN } }),
				false,
				'OFFER_CLOSED',
			],
			[
				'an accepted offer',
				joined({ offerRow: { ...joined().offerRow, offerStatus: OfferStatus.ACCEPTED } }),
				true,
				null,
			],
			['a deleted creator', joined({ creatorData: null }), false, 'MEMBER_UNAVAILABLE'],
			[
				'a blocked owner',
				joined({ userData: { _id: ownerId, memberStatus: MemberStatus.BLOCK } }),
				false,
				'MEMBER_UNAVAILABLE',
			],
			['an admin lock', joined({ lockedByAdmin: true }), false, 'LOCKED_BY_ADMIN'],
		])('%s → canWrite %s, readOnlyReason %s', async (_label, row, canWrite, reason) => {
			conversationModel.resolve('aggregate', [row]);
			const result = await service.getConversation(owner, conversationId);
			expect(result.canWrite).toBe(canWrite);
			expect(result.readOnlyReason).toBe(reason as ConversationReadOnlyReason | null);
		});

		it('the offer is shown as the members see it: an expired PENDING one as EXPIRED', async () => {
			conversationModel.resolve('aggregate', [joined({ offerRow: { ...joined().offerRow, expiresAt: YESTERDAY } })]);
			expect((await service.getConversation(owner, conversationId)).offerData?.offerStatus).toBe(OfferStatus.EXPIRED);
		});

		it('an admin sees the metadata of every conversation: no unread count, never the last message', async () => {
			conversationModel.resolve('aggregate', [
				{ list: [joined({ lastMessagePreview: 'My phone is …', lastMessageAt: NOW })], metaCounter: [{ total: 1 }] },
			]);
			const result = await service.getConversationsByAdmin(admin, { page: 1, limit: 10 });
			expect(firstMatch()).toEqual({ $match: {} });
			expect(result.list[0].meUnread).toBeNull();
			expect(result.list[0].lastMessagePreview).toBeUndefined();
			expect(result.list[0].lastMessageAt).toEqual(NOW);
		});

		it.each([
			[true, { lockedByAdmin: true }],
			[false, { lockedByAdmin: { $ne: true } }],
		])('an admin filters by lockedByAdmin %s', async (lockedByAdmin, match) => {
			conversationModel.resolve('aggregate', [{ list: [], metaCounter: [] }]);
			await service.getConversationsByAdmin(admin, { page: 1, limit: 10, lockedByAdmin });
			expect(firstMatch()).toEqual({ $match: match });
		});

		it('a member still sees the last message in their own list', async () => {
			conversationModel.resolve('aggregate', [{ list: [joined({ lastMessagePreview: 'Hello' })], metaCounter: [] }]);
			const result = await service.getMyConversations(owner, { page: 1, limit: 10 });
			expect(result.list[0].lastMessagePreview).toBe('Hello');
		});
	});

	describe('sendMessage', () => {
		const readyToSend = (row = joined()) => {
			messageModel.resolve('findOne', null); // no retry
			conversationModel.resolve('aggregate', [row]);
			messageModel.resolve('findOne', { createdAt: new Date(NOW.getTime() - 5000) }); // last message 5 s ago
		};

		beforeEach(() => {
			messageModel.create.mockImplementation((doc: object) =>
				Promise.resolve({ toObject: () => ({ _id: new Types.ObjectId(), createdAt: NOW, ...doc }) }),
			);
		});

		it('stores the trimmed text, counts it unread for the other side, then tells both members', async () => {
			readyToSend();
			const message = await service.sendMessage(owner, sendInput());

			expect(messageModel.create).toHaveBeenCalledWith({
				conversationId,
				senderId: ownerId,
				messageText: 'When can you start?',
				clientMessageId: sendInput().clientMessageId,
			});
			expect(conversationModel.updateOne).toHaveBeenCalledWith(
				{ _id: conversationId },
				{
					$set: { lastMessageAt: NOW, lastMessagePreview: 'When can you start?', lastSenderId: ownerId },
					$inc: { creatorUnread: 1 },
				},
			);
			expect(publisher.publish).toHaveBeenCalledWith([ownerId, creatorId], 'chat:message', { conversationId, message });
		});

		it("the creator's message counts for the owner; the preview is cut to 140 characters", async () => {
			readyToSend();
			await service.sendMessage(creator, sendInput({ messageText: 'a'.repeat(300) }));

			const update = conversationModel.updateOne.mock.calls[0][1] as {
				$set: { lastMessagePreview: string };
				$inc: object;
			};
			expect(update.$inc).toEqual({ userUnread: 1 });
			expect(update.$set.lastMessagePreview).toHaveLength(140);
		});

		it('a read-only conversation → CONVERSATION_READ_ONLY, nothing stored or pushed', async () => {
			messageModel.resolve('findOne', null);
			conversationModel.resolve('aggregate', [joined({ lockedByAdmin: true })]);

			await expectHttpError(
				service.sendMessage(owner, sendInput()),
				BadRequestException,
				Message.CONVERSATION_READ_ONLY,
			);
			expect(messageModel.create).not.toHaveBeenCalled();
			expect(publisher.publish).not.toHaveBeenCalled();
		});

		it('a stranger → NOT_FOUND', async () => {
			messageModel.resolve('findOne', null);
			conversationModel.resolve('aggregate', []);
			await expectHttpError(
				service.sendMessage({ ...owner, _id: strangerId }, sendInput()),
				NotFoundException,
				Message.NO_DATA_FOUND,
			);
		});

		it('within a second of the last message → CHAT_RATE_LIMITED', async () => {
			messageModel.resolve('findOne', null);
			conversationModel.resolve('aggregate', [joined()]);
			messageModel.resolve('findOne', { createdAt: new Date(NOW.getTime() - 400) });

			await expectHttpError(service.sendMessage(owner, sendInput()), BadRequestException, Message.CHAT_RATE_LIMITED);
			expect(messageModel.create).not.toHaveBeenCalled();
		});

		it('a retry with the same clientMessageId returns the stored message: nothing new, no second push', async () => {
			const stored = { _id: new Types.ObjectId(), messageText: 'When can you start?' };
			messageModel.resolve('findOne', stored);

			await expect(service.sendMessage(owner, sendInput())).resolves.toBe(stored);
			expect(messageModel.findOne).toHaveBeenCalledWith({
				senderId: ownerId,
				clientMessageId: sendInput().clientMessageId,
			});
			expect(messageModel.create).not.toHaveBeenCalled();
			expect(publisher.publish).not.toHaveBeenCalled();
		});

		it('only spaces → INVALID_CHAT_MESSAGE', async () => {
			await expectHttpError(
				service.sendMessage(owner, sendInput({ messageText: '   ' })),
				BadRequestException,
				Message.INVALID_CHAT_MESSAGE,
			);
		});

		it('a failed push does not fail the send: the message is stored, clients catch up', async () => {
			readyToSend();
			publisher.publish.mockImplementation(() => {
				throw new Error('socket down');
			});
			await expect(service.sendMessage(owner, sendInput())).resolves.toMatchObject({
				messageText: 'When can you start?',
			});
		});
	});

	describe('getMessages: cursor pages, always oldest first', () => {
		const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ _id: `m${i}` }));

		it('no cursor: the latest page, reversed; hasMore when there is an older one', async () => {
			conversationModel.resolve('exists', { _id: conversationId });
			messageModel.resolve('find', rows(4)); // newest first, limit + 1

			const result = await service.getMessages(owner, { conversationId, limit: 3 });

			expect(messageModel.find).toHaveBeenCalledWith({ conversationId });
			const query = messageModel.find.mock.results[0].value as { sort: jest.Mock; limit: jest.Mock };
			expect(query.sort).toHaveBeenCalledWith({ _id: -1 });
			expect(query.limit).toHaveBeenCalledWith(4);
			expect(result).toEqual({ list: [{ _id: 'm2' }, { _id: 'm1' }, { _id: 'm0' }], hasMore: true });
		});

		it('after: newer messages, oldest first as stored', async () => {
			const after = new Types.ObjectId();
			conversationModel.resolve('exists', { _id: conversationId });
			messageModel.resolve('find', rows(2));

			const result = await service.getMessages(owner, { conversationId, after, limit: 3 });

			expect(messageModel.find).toHaveBeenCalledWith({ conversationId, _id: { $gt: after } });
			expect(result).toEqual({ list: [{ _id: 'm0' }, { _id: 'm1' }], hasMore: false });
		});

		it('a stranger → NOT_FOUND; before and after together → BAD_REQUEST', async () => {
			await expectHttpError(
				service.getMessages(owner, { conversationId, limit: 3 }),
				NotFoundException,
				Message.NO_DATA_FOUND,
			);
			const id = new Types.ObjectId();
			await expectHttpError(
				service.getMessages(owner, { conversationId, before: id, after: id, limit: 3 }),
				BadRequestException,
				Message.BAD_REQUEST,
			);
			expect(messageModel.find).not.toHaveBeenCalled();
		});
	});

	describe('unread', () => {
		it("markConversationRead zeroes the caller's side only and tells the caller's other tabs", async () => {
			conversationModel
				.resolve('findOne', { userId: ownerId })
				.resolve('aggregate', [joined({ creatorUnread: 5, userUnread: 0 })]);

			await service.markConversationRead(creator, conversationId);

			expect(conversationModel.updateOne).toHaveBeenCalledWith({ _id: conversationId }, { $set: { creatorUnread: 0 } });
			expect(publisher.publish).toHaveBeenCalledWith([creatorId], 'chat:read', { conversationId });
		});

		it('getUnreadCount sums the side the caller is on, per conversation', async () => {
			conversationModel.resolve('aggregate', [{ total: 7 }]);
			await expect(service.getUnreadCount(owner)).resolves.toBe(7);
			expect(conversationModel.aggregate.mock.calls[0][0]).toEqual([
				{ $match: { $or: [{ userId: ownerId }, { creatorId: ownerId }] } },
				{
					$group: {
						_id: null,
						total: { $sum: { $cond: [{ $eq: ['$userId', ownerId] }, '$userUnread', '$creatorUnread'] } },
					},
				},
			]);
		});
	});

	describe('lockConversationByAdmin', () => {
		it('sets the lock; a missing conversation → NOT_FOUND', async () => {
			conversationModel
				.resolve('updateOne', { matchedCount: 1 })
				.resolve('aggregate', [joined({ lockedByAdmin: true })]);
			const result = await service.lockConversationByAdmin(admin, conversationId, true);
			expect(conversationModel.updateOne).toHaveBeenCalledWith(
				{ _id: conversationId },
				{ $set: { lockedByAdmin: true } },
			);
			expect(result.readOnlyReason).toBe(ConversationReadOnlyReason.LOCKED_BY_ADMIN);

			conversationModel.resolve('updateOne', { matchedCount: 0 });
			await expectHttpError(
				service.lockConversationByAdmin(admin, conversationId, false),
				NotFoundException,
				Message.NO_DATA_FOUND,
			);
		});
	});
});
