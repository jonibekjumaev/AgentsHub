import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { expectHttpError } from '../../../test/utils/http-error';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { CommentGroup } from '../../libs/enums/comment.enum';
import { Message } from '../../libs/enums/common.enum';
import { NotificationGroup, NotificationStatus, NotificationType } from '../../libs/enums/notification.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { MemberPublisher } from '../../socket/member.publisher';
import { NotificationResolver } from './notification.resolver';
import { NotificationService } from './notification.service';

const ownerId = new Types.ObjectId();
const creatorId = new Types.ObjectId();
const briefId = new Types.ObjectId();
const notificationId = new Types.ObjectId();
const offer = { briefId, userId: ownerId, creatorId };

describe('NotificationService (D-50)', () => {
	let service: NotificationService;
	let models: Record<'notification' | 'brief' | 'product' | 'boardArticle' | 'member', MockModel>;
	let publisher: { publish: jest.Mock };
	let logSpy: jest.SpyInstance;

	beforeEach(async () => {
		models = {
			notification: createMockModel(),
			brief: createMockModel(),
			product: createMockModel(),
			boardArticle: createMockModel(),
			member: createMockModel(),
		};
		models.notification.create.mockResolvedValue({ _id: notificationId });
		publisher = { publish: jest.fn() };
		logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

		const moduleRef = await Test.createTestingModule({
			providers: [
				NotificationService,
				{ provide: getModelToken('Notification'), useValue: models.notification },
				{ provide: getModelToken('Brief'), useValue: models.brief },
				{ provide: getModelToken('Product'), useValue: models.product },
				{ provide: getModelToken('BoardArticle'), useValue: models.boardArticle },
				{ provide: getModelToken('Member'), useValue: models.member },
				{ provide: MemberPublisher, useValue: publisher },
			],
		}).compile();
		service = moduleRef.get(NotificationService);
	});

	afterEach(() => {
		logSpy.mockRestore();
	});

	describe('offers and invites', () => {
		it.each([
			[NotificationType.OFFER_RECEIVED, creatorId, ownerId],
			[NotificationType.OFFER_WITHDRAWN, creatorId, ownerId],
			[NotificationType.OFFER_ACCEPTED, ownerId, creatorId],
			[NotificationType.OFFER_DECLINED, ownerId, creatorId],
		] as const)('%s: from the other side, with the brief title as the snapshot', async (type, authorId, receiverId) => {
			models.brief.resolve('findById', { briefTitle: 'Support bot' });

			await service.notifyOffer(type, offer);

			expect(models.notification.create).toHaveBeenCalledWith({
				notificationType: type,
				notificationGroup: NotificationGroup.BRIEF,
				notificationTitle: 'Support bot',
				authorId,
				receiverId,
				briefId,
			});
			expect(publisher.publish).toHaveBeenCalledWith([receiverId], 'notification:new', {
				notificationId: String(notificationId),
			});
		});

		it('an invite goes to the creator, from the owner', async () => {
			models.brief.resolve('findById', { briefTitle: 'Support bot' });
			await service.notifyInvite(offer);
			expect(models.notification.create).toHaveBeenCalledWith(
				expect.objectContaining({
					notificationType: NotificationType.INVITE,
					authorId: ownerId,
					receiverId: creatorId,
				}),
			);
		});

		it('a brief that is gone sends nothing', async () => {
			await service.notifyOffer(NotificationType.OFFER_RECEIVED, offer);
			expect(models.notification.create).not.toHaveBeenCalled();
			expect(publisher.publish).not.toHaveBeenCalled();
		});
	});

	describe('comments', () => {
		const authorId = new Types.ObjectId();
		const refId = new Types.ObjectId();

		it.each([
			[
				CommentGroup.PRODUCT,
				'product',
				{ memberId: creatorId, productTitle: 'BakeBot' },
				NotificationGroup.PRODUCT,
				'BakeBot',
				creatorId,
				{ productId: refId },
			],
			[
				CommentGroup.BRIEF,
				'brief',
				{ memberId: ownerId, briefTitle: 'Support bot' },
				NotificationGroup.BRIEF,
				'Support bot',
				ownerId,
				{ briefId: refId },
			],
			[
				CommentGroup.ARTICLE,
				'boardArticle',
				{ memberId: ownerId, articleTitle: 'RAG tips' },
				NotificationGroup.ARTICLE,
				'RAG tips',
				ownerId,
				{ articleId: refId },
			],
			[CommentGroup.MEMBER, 'member', { memberNick: 'nova_labs' }, NotificationGroup.MEMBER, 'nova_labs', refId, {}],
		] as const)(
			'%s: to the owner of the %s',
			async (group, model, target, notificationGroup, title, receiverId, ref) => {
				models[model].resolve('findById', target);

				await service.notifyComment(authorId, group, refId, '  Great   work,\nthanks! ');

				expect(models.notification.create).toHaveBeenCalledWith({
					notificationType: NotificationType.COMMENT,
					notificationGroup,
					notificationTitle: title,
					notificationDesc: 'Great work, thanks!',
					authorId,
					receiverId,
					...ref,
				});
			},
		);

		it('quotes at most 140 characters of the comment', async () => {
			models.brief.resolve('findById', { memberId: ownerId, briefTitle: 'Support bot' });
			await service.notifyComment(authorId, CommentGroup.BRIEF, refId, 'a'.repeat(500));
			const [doc] = models.notification.create.mock.calls[0] as [{ notificationDesc: string }];
			expect(doc.notificationDesc).toHaveLength(140);
			expect(doc.notificationDesc.endsWith('…')).toBe(true);
		});

		it('nobody is notified about their own comment', async () => {
			models.brief.resolve('findById', { memberId: authorId, briefTitle: 'My brief' });
			await service.notifyComment(authorId, CommentGroup.BRIEF, refId, 'Note to self');
			expect(models.notification.create).not.toHaveBeenCalled();
		});
	});

	describe('follows', () => {
		it('once per follower: re-following sends nothing new', async () => {
			models.notification.resolve('exists', null).resolve('exists', { _id: notificationId });
			models.member.resolve('findById', { memberNick: 'dilnoza' });

			await service.notifyFollow(ownerId, creatorId);
			await service.notifyFollow(ownerId, creatorId);

			expect(models.notification.exists).toHaveBeenCalledWith({
				notificationType: NotificationType.FOLLOW,
				authorId: ownerId,
				receiverId: creatorId,
			});
			expect(models.notification.create).toHaveBeenCalledTimes(1);
			expect(models.notification.create).toHaveBeenCalledWith(
				expect.objectContaining({ notificationTitle: 'dilnoza', receiverId: creatorId }),
			);
		});
	});

	describe('best effort', () => {
		it('a database error is logged, never thrown: the action that caused it already happened', async () => {
			models.brief.resolve('findById', { briefTitle: 'Support bot' });
			models.notification.create.mockRejectedValueOnce(new Error('connection lost'));

			await expect(service.notifyOffer(NotificationType.OFFER_RECEIVED, offer)).resolves.toBeUndefined();
			expect(logSpy).toHaveBeenCalledWith('Error: NotificationService', 'connection lost');
			expect(publisher.publish).not.toHaveBeenCalled();
		});

		it('a push that fails does not undo the stored notification', async () => {
			models.brief.resolve('findById', { briefTitle: 'Support bot' });
			publisher.publish.mockImplementation(() => {
				throw new Error('socket closed');
			});
			await expect(service.notifyOffer(NotificationType.OFFER_RECEIVED, offer)).resolves.toBeUndefined();
			expect(models.notification.create).toHaveBeenCalledTimes(1);
		});
	});

	describe('reading', () => {
		it('lists the caller’s own, latest first; unreadOnly keeps WAIT ones', async () => {
			models.notification.resolve('aggregate', [{ list: [], metaCounter: [] }]);
			await service.getMyNotifications(ownerId, { page: 2, limit: 10, unreadOnly: true });

			const [pipeline] = models.notification.aggregate.mock.calls[0] as [Array<Record<string, unknown>>];
			expect(pipeline[0]).toEqual({ $match: { receiverId: ownerId, notificationStatus: NotificationStatus.WAIT } });
			expect(pipeline[1]).toEqual({ $sort: { createdAt: -1, _id: -1 } });
			const facet = pipeline[2].$facet as { list: object[] };
			expect(facet.list.slice(0, 2)).toEqual([{ $skip: 10 }, { $limit: 10 }]);
		});

		it('counts the unread ones', async () => {
			models.notification.resolve('countDocuments', 4);
			await expect(service.getUnreadCount(ownerId)).resolves.toBe(4);
			expect(models.notification.countDocuments).toHaveBeenCalledWith({
				receiverId: ownerId,
				notificationStatus: NotificationStatus.WAIT,
			});
		});

		it('marks one read, only the caller’s own; someone else’s → NOT_FOUND', async () => {
			models.notification.resolve('findOneAndUpdate', { _id: notificationId });
			await service.markNotificationRead(ownerId, notificationId);
			expect(models.notification.findOneAndUpdate.mock.calls[0][0]).toEqual({
				_id: notificationId,
				receiverId: ownerId,
			});
			expect(publisher.publish).toHaveBeenCalledWith([ownerId], 'notification:read', {});

			await expectHttpError(
				service.markNotificationRead(creatorId, notificationId),
				NotFoundException,
				Message.NO_DATA_FOUND,
			);
		});

		it('marks all read and tells the other tabs only when something changed', async () => {
			models.notification.resolve('updateMany', { modifiedCount: 3 }).resolve('updateMany', { modifiedCount: 0 });

			await expect(service.markAllNotificationsRead(ownerId)).resolves.toBe(3);
			await expect(service.markAllNotificationsRead(ownerId)).resolves.toBe(0);
			expect(publisher.publish).toHaveBeenCalledTimes(1);
		});
	});

	it('USER and CREATOR only: an admin has no notifications (D-40 principle)', () => {
		for (const name of [
			'getMyNotifications',
			'getNotificationUnreadCount',
			'markNotificationRead',
			'markAllNotificationsRead',
		]) {
			const handler = Object.getOwnPropertyDescriptor(NotificationResolver.prototype, name)!.value as object;
			expect(Reflect.getMetadata('roles', handler)).toEqual([MemberType.USER, MemberType.CREATOR]);
		}
	});
});
