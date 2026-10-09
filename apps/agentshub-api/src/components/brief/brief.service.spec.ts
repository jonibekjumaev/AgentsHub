import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { expectHttpError } from '../../../test/utils/http-error';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { BriefInput } from '../../libs/dto/brief/brief.input';
import { AgentCategory } from '../../libs/enums/agent-category.enum';
import { Message } from '../../libs/enums/common.enum';
import { StatisticModifier } from '../../libs/types/common';
import { MemberService } from '../member/member.service';
import { ViewService } from '../view/view.service';
import { BriefService } from './brief.service';

const ownerId = new Types.ObjectId();
const briefId = new Types.ObjectId();

describe('BriefService', () => {
	let service: BriefService;
	let briefModel: MockModel;
	let memberService: { memberStatsEditor: jest.Mock<Promise<unknown>, [StatisticModifier]>; getMember: jest.Mock };
	let viewService: { recordView: jest.Mock };

	beforeEach(async () => {
		briefModel = createMockModel();
		memberService = {
			memberStatsEditor: jest.fn<Promise<unknown>, [StatisticModifier]>().mockResolvedValue({}),
			getMember: jest.fn().mockResolvedValue({ _id: ownerId, memberNick: 'owner' }),
		};
		viewService = { recordView: jest.fn().mockResolvedValue(null) };

		const moduleRef = await Test.createTestingModule({
			providers: [
				BriefService,
				{ provide: getModelToken('Brief'), useValue: briefModel },
				{ provide: MemberService, useValue: memberService },
				{ provide: ViewService, useValue: viewService },
			],
		}).compile();
		service = moduleRef.get(BriefService);
	});

	describe('createBrief', () => {
		const briefInput = (fields: Partial<BriefInput> = {}): BriefInput => ({
			briefCategory: AgentCategory.CUSTOMER_SUPPORT,
			briefTitle: 'Support bot for a shop',
			briefContent: 'Answer order questions in Telegram, 24/7.',
			memberId: ownerId,
			...fields,
		});

		beforeEach(() => {
			briefModel.create.mockImplementation((input: BriefInput) => Promise.resolve({ _id: briefId, ...input }));
		});

		it("adds 1 to the owner's memberBriefs (D-30, ER rule 5)", async () => {
			await service.createBrief(briefInput());

			expect(memberService.memberStatsEditor).toHaveBeenCalledWith({
				_id: ownerId,
				targetKey: 'memberBriefs',
				modifier: 1,
			});
		});

		it('answers a database error on create with CREATE_FAILED, and changes no counter', async () => {
			briefModel.create.mockRejectedValue(new Error('connection lost'));

			await expectHttpError(service.createBrief(briefInput()), BadRequestException, Message.CREATE_FAILED);
			expect(memberService.memberStatsEditor).not.toHaveBeenCalled();
		});

		it('passes a memberBriefs failure through as a server error, not CREATE_FAILED (B20)', async () => {
			memberService.memberStatsEditor.mockRejectedValue(new InternalServerErrorException(Message.UPDATE_FAILED));

			await expectHttpError(service.createBrief(briefInput()), InternalServerErrorException, Message.UPDATE_FAILED);
			expect(briefModel.create).toHaveBeenCalledTimes(1);
		});
	});
});
