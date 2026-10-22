import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { expectHttpError } from '../../../test/utils/http-error';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { Message } from '../../libs/enums/common.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { MemberService } from '../member/member.service';
import { FollowResolver } from './follow.resolver';
import { FollowService } from './follow.service';

describe('follows and admins (D-40)', () => {
	const followerId = new Types.ObjectId();
	const targetId = new Types.ObjectId();
	let service: FollowService;
	let followModel: MockModel;
	let memberService: { getMember: jest.Mock; memberStatsEditor: jest.Mock };

	beforeEach(async () => {
		followModel = createMockModel();
		memberService = { getMember: jest.fn(), memberStatsEditor: jest.fn().mockResolvedValue({}) };
		const moduleRef = await Test.createTestingModule({
			providers: [
				FollowService,
				{ provide: getModelToken('Follow'), useValue: followModel },
				{ provide: MemberService, useValue: memberService },
			],
		}).compile();
		service = moduleRef.get(FollowService);
	});

	it('nobody can follow an admin: NOT_FOUND, like a missing member, and no counter moves', async () => {
		memberService.getMember.mockResolvedValue({ _id: targetId, memberType: MemberType.ADMIN });

		await expectHttpError(service.subscribe(followerId, targetId), NotFoundException, Message.NO_DATA_FOUND);
		expect(followModel.create).not.toHaveBeenCalled();
		expect(memberService.memberStatsEditor).not.toHaveBeenCalled();
	});

	it('a USER or CREATOR target can be followed as before', async () => {
		memberService.getMember.mockResolvedValue({ _id: targetId, memberType: MemberType.CREATOR });
		followModel.create.mockResolvedValue({ _id: new Types.ObjectId(), followerId, followingId: targetId });

		await service.subscribe(followerId, targetId);
		expect(memberService.memberStatsEditor).toHaveBeenCalledTimes(2);
	});

	it('an admin can not follow anyone: subscribe is for USER and CREATOR only', () => {
		const subscribe = Object.getOwnPropertyDescriptor(FollowResolver.prototype, 'subscribe')!.value as object;
		const roles = Reflect.getMetadata('roles', subscribe) as string[];
		expect(roles).toEqual([MemberType.USER, MemberType.CREATOR]);
	});
});
