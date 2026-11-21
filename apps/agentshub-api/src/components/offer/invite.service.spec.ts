import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { expectHttpError } from '../../../test/utils/http-error';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { createNotificationMock, NotificationMock } from '../../../test/utils/notification-mock';
import { NotificationService } from '../notification/notification.service';
import { BriefStatus } from '../../libs/enums/brief.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { Message } from '../../libs/enums/common.enum';
import { MemberService } from '../member/member.service';
import { InviteService } from './invite.service';

const ownerId = new Types.ObjectId();
const creatorId = new Types.ObjectId();
const briefId = new Types.ObjectId();

const NOW = new Date('2026-11-13T12:00:00.000Z');
const YESTERDAY = new Date('2026-11-12T12:00:00.000Z');

const ownBrief = (fields: object = {}) => ({
	_id: briefId,
	memberId: ownerId,
	briefStatus: BriefStatus.OPEN,
	...fields,
});
const activeCreator = (fields: object = {}) => ({
	_id: creatorId,
	memberType: MemberType.CREATOR,
	memberStatus: MemberStatus.ACTIVE,
	...fields,
});
const invite = { _id: new Types.ObjectId(), briefId, creatorId, userId: ownerId };

describe('InviteService (D-48)', () => {
	let service: InviteService;
	let inviteModel: MockModel;
	let briefModel: MockModel;
	let memberService: { getAuthorData: jest.Mock };
	let notifications: NotificationMock;

	beforeEach(async () => {
		notifications = createNotificationMock();
		inviteModel = createMockModel();
		briefModel = createMockModel();
		memberService = { getAuthorData: jest.fn().mockResolvedValue(activeCreator()) };

		const moduleRef = await Test.createTestingModule({
			providers: [
				InviteService,
				{ provide: NotificationService, useValue: notifications },
				{ provide: getModelToken('Invite'), useValue: inviteModel },
				{ provide: getModelToken('Brief'), useValue: briefModel },
				{ provide: MemberService, useValue: memberService },
			],
		}).compile();
		service = moduleRef.get(InviteService);

		jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("stores an invite for the caller's OPEN brief and an ACTIVE creator", async () => {
		briefModel.resolve('findOne', ownBrief());
		inviteModel
			.resolve('findOne', null)
			.resolve('countDocuments', 0)
			.resolve('updateOne', { upsertedCount: 1 })
			.resolve('findOne', invite);

		await expect(service.inviteCreator(ownerId, briefId, creatorId)).resolves.toBe(invite);
		expect(notifications.notifyInvite).toHaveBeenCalledWith(invite); // D-50

		expect(briefModel.findOne).toHaveBeenCalledWith({ _id: briefId, memberId: ownerId });
		expect(inviteModel.updateOne).toHaveBeenCalledWith(
			{ briefId, creatorId },
			{ $setOnInsert: { briefId, creatorId, userId: ownerId } },
			{ upsert: true },
		);
	});

	it('is idempotent: an existing invite is answered as it is, without the daily limit', async () => {
		briefModel.resolve('findOne', ownBrief());
		inviteModel.resolve('findOne', invite);

		await expect(service.inviteCreator(ownerId, briefId, creatorId)).resolves.toBe(invite);
		expect(inviteModel.countDocuments).not.toHaveBeenCalled();
		expect(inviteModel.updateOne).not.toHaveBeenCalled();
		expect(notifications.notifyInvite).not.toHaveBeenCalled();
	});

	it('D-50: two invites at once notify once: only the request that inserted it', async () => {
		briefModel.resolve('findOne', ownBrief());
		inviteModel
			.resolve('findOne', null)
			.resolve('countDocuments', 0)
			.resolve('updateOne', { upsertedCount: 0 })
			.resolve('findOne', invite);

		await expect(service.inviteCreator(ownerId, briefId, creatorId)).resolves.toBe(invite);
		expect(notifications.notifyInvite).not.toHaveBeenCalled();
	});

	it.each([
		['someone else’s or a missing brief', null],
		['a deleted brief', ownBrief({ briefStatus: BriefStatus.DELETE })],
	])('%s → NOT_FOUND', async (_label, brief) => {
		briefModel.resolve('findOne', brief);
		await expectHttpError(service.inviteCreator(ownerId, briefId, creatorId), NotFoundException, Message.NO_DATA_FOUND);
	});

	it('a CLOSED brief → BRIEF_NOT_OPEN', async () => {
		briefModel.resolve('findOne', ownBrief({ briefStatus: BriefStatus.CLOSED }));
		await expectHttpError(
			service.inviteCreator(ownerId, briefId, creatorId),
			BadRequestException,
			Message.BRIEF_NOT_OPEN,
		);
	});

	it.each([
		['a USER', activeCreator({ memberType: MemberType.USER })],
		['a blocked creator', activeCreator({ memberStatus: MemberStatus.BLOCK })],
		['a deleted or missing member', null],
	])('%s cannot be invited → INVALID_INVITE_TARGET', async (_label, member) => {
		briefModel.resolve('findOne', ownBrief());
		memberService.getAuthorData.mockResolvedValueOnce(member);

		await expectHttpError(
			service.inviteCreator(ownerId, briefId, creatorId),
			BadRequestException,
			Message.INVALID_INVITE_TARGET,
		);
		expect(inviteModel.updateOne).not.toHaveBeenCalled();
	});

	it('the 21st invite in 24 hours → INVITE_DAILY_LIMIT', async () => {
		briefModel.resolve('findOne', ownBrief());
		inviteModel.resolve('findOne', null).resolve('countDocuments', 20);

		await expectHttpError(
			service.inviteCreator(ownerId, briefId, creatorId),
			BadRequestException,
			Message.INVITE_DAILY_LIMIT,
		);
		expect(inviteModel.countDocuments).toHaveBeenCalledWith({ userId: ownerId, createdAt: { $gt: YESTERDAY } });
	});

	it('two invites at the same moment: E11000 is swallowed, the invite exists either way', async () => {
		briefModel.resolve('findOne', ownBrief());
		inviteModel
			.resolve('findOne', null)
			.resolve('countDocuments', 0)
			.reject('updateOne', Object.assign(new Error('E11000'), { code: 11000 }))
			.resolve('findOne', invite);

		await expect(service.inviteCreator(ownerId, briefId, creatorId)).resolves.toBe(invite);
	});
});
