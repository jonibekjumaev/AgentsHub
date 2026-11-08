import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { expectHttpError } from '../../../test/utils/http-error';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { BriefInput } from '../../libs/dto/brief/brief.input';
import { BriefUpdate } from '../../libs/dto/brief/brief.update';
import { AgentCategory } from '../../libs/enums/agent-category.enum';
import { BriefBudgetType, BriefStatus } from '../../libs/enums/brief.enum';
import { Direction, Message } from '../../libs/enums/common.enum';
import { ViewGroup } from '../../libs/enums/view.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { StatisticModifier } from '../../libs/types/common';
import { MemberService } from '../member/member.service';
import { ViewService } from '../view/view.service';
import { BriefService } from './brief.service';

const { OPEN, CLOSED, DELETE } = BriefStatus;
const { FIXED, OPEN_TO_OFFERS } = BriefBudgetType;

const ownerId = new Types.ObjectId();
const otherId = new Types.ObjectId();
const briefId = new Types.ObjectId();

// "now" is frozen, so the deadline rule (D-05, D-31) is checked against a fixed time
const NOW = new Date('2026-10-09T12:00:00.000Z');
const PAST = new Date('2026-10-08T12:00:00.000Z');
const FUTURE = new Date('2026-10-10T12:00:00.000Z');

/** D-44: "not past its deadline": no deadline, or one later than now */
const notPast = { briefDeadline: { $not: { $lte: NOW } } };

/** What applyBriefUpdate reads before it writes (status and deadline only) */
const storedBrief = (fields: object = {}) => ({ briefStatus: OPEN, ...fields });
/** A full brief as getBrief reads it */
const fullBrief = (fields: object = {}) => ({ _id: briefId, memberId: ownerId, briefViews: 3, ...storedBrief(fields) });

describe('BriefService', () => {
	let service: BriefService;
	let briefModel: MockModel;
	let memberService: {
		memberStatsEditor: jest.Mock<Promise<unknown>, [StatisticModifier]>;
		getMember: jest.Mock;
		getAuthorData: jest.Mock;
	};
	let viewService: { recordView: jest.Mock };

	beforeEach(async () => {
		briefModel = createMockModel();
		memberService = {
			memberStatsEditor: jest.fn<Promise<unknown>, [StatisticModifier]>().mockResolvedValue({}),
			getMember: jest.fn().mockResolvedValue({ _id: ownerId, memberNick: 'owner' }),
			getAuthorData: jest.fn().mockResolvedValue({ _id: ownerId, memberNick: 'owner' }),
		};
		viewService = { recordView: jest.fn().mockResolvedValue(false) };

		const moduleRef = await Test.createTestingModule({
			providers: [
				BriefService,
				{ provide: getModelToken('Brief'), useValue: briefModel },
				{ provide: MemberService, useValue: memberService },
				{ provide: ViewService, useValue: viewService },
			],
		}).compile();
		service = moduleRef.get(BriefService);

		// only the clock is frozen; promise scheduling stays real
		jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	const memberBriefsChanges = () =>
		memberService.memberStatsEditor.mock.calls.filter(([input]) => input.targetKey === 'memberBriefs');

	describe('createBrief', () => {
		const briefInput = (fields: Partial<BriefInput> = {}): BriefInput => ({
			briefCategory: AgentCategory.CUSTOMER_SUPPORT,
			briefTitle: 'Support bot for a shop',
			briefContent: 'Answer order questions in Telegram, 24/7.',
			memberId: ownerId,
			...fields,
		});
		const createdWith = () => briefModel.create.mock.calls[0][0];

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

		describe('briefBudget: optional, > 0 if given (D-04)', () => {
			it.each([0.01, 500])('accepts %p', async (briefBudget) => {
				await service.createBrief(briefInput({ briefBudget }));

				expect(createdWith()).toMatchObject({ briefBudget });
			});

			it.each([0, -1])('rejects %p with INVALID_BUDGET, nothing stored', async (briefBudget) => {
				await expectHttpError(
					service.createBrief(briefInput({ briefBudget })),
					BadRequestException,
					Message.INVALID_BUDGET,
				);
				expect(briefModel.create).not.toHaveBeenCalled();
			});

			it('stores no budget field for null or none: open to offers', async () => {
				await service.createBrief(briefInput({ briefBudget: null as unknown as number }));
				await service.createBrief(briefInput());

				expect(briefModel.create.mock.calls[0][0]).not.toHaveProperty('briefBudget');
				expect(briefModel.create.mock.calls[1][0]).not.toHaveProperty('briefBudget');
			});
		});

		describe('briefDeadline: optional, in the future if given (D-05)', () => {
			it('accepts a future deadline', async () => {
				await service.createBrief(briefInput({ briefDeadline: FUTURE }));

				expect(createdWith()).toMatchObject({ briefDeadline: FUTURE });
			});

			it.each([
				['a past deadline', PAST],
				['a deadline of exactly now', NOW],
			])('rejects %s with DEADLINE_IN_PAST, nothing stored', async (_label, briefDeadline) => {
				await expectHttpError(
					service.createBrief(briefInput({ briefDeadline })),
					BadRequestException,
					Message.DEADLINE_IN_PAST,
				);
				expect(briefModel.create).not.toHaveBeenCalled();
			});

			it('stores no deadline field for null', async () => {
				await service.createBrief(briefInput({ briefDeadline: null as unknown as Date }));

				expect(createdWith()).not.toHaveProperty('briefDeadline');
			});
		});
	});

	describe('updateBrief / updateBriefByAdmin', () => {
		/** Queues the stored brief and the written result, then runs the owner or admin update */
		const runUpdate = (stored: object | null, input: Partial<BriefUpdate>, by: 'owner' | 'admin' = 'owner') => {
			briefModel.resolve('findOne', stored);
			briefModel.resolve('findOneAndUpdate', { _id: briefId, memberId: ownerId });
			const update = { _id: briefId, ...input };
			return by === 'owner' ? service.updateBrief(ownerId, update) : service.updateBriefByAdmin(update);
		};
		const readFilter = () => briefModel.findOne.mock.calls[0][0];
		const writeFilter = () => briefModel.findOneAndUpdate.mock.calls[0][0];
		const writtenUpdate = () => briefModel.findOneAndUpdate.mock.calls[0][1] as Record<string, unknown>;

		describe('who can update what (D-30)', () => {
			it('the owner update matches only their own, non-deleted brief', async () => {
				await runUpdate(storedBrief(), { briefTitle: 'New title' });

				expect(readFilter()).toEqual({ _id: briefId, memberId: ownerId, briefStatus: { $ne: DELETE } });
			});

			it("the admin update matches any member's non-deleted brief", async () => {
				await runUpdate(storedBrief(), { briefTitle: 'New title' }, 'admin');

				expect(readFilter()).toEqual({ _id: briefId, briefStatus: { $ne: DELETE } });
			});

			it.each(['owner', 'admin'] as const)(
				'a missing, foreign or deleted brief answers NOT_FOUND UPDATE_FAILED for the %s',
				async (by) => {
					await expectHttpError(runUpdate(null, { briefTitle: 'x' }, by), NotFoundException, Message.UPDATE_FAILED);
					expect(briefModel.findOneAndUpdate).not.toHaveBeenCalled();
				},
			);

			it('the fields of a CLOSED brief can be edited', async () => {
				await runUpdate(storedBrief({ briefStatus: CLOSED }), { briefTitle: 'New title' });

				expect(writtenUpdate()).toMatchObject({ briefTitle: 'New title' });
			});
		});

		describe('status changes (D-30)', () => {
			it.each(['owner', 'admin'] as const)('OPEN → CLOSED sets closedAt, no counter change (%s)', async (by) => {
				await runUpdate(storedBrief(), { briefStatus: CLOSED }, by);

				expect(writtenUpdate().closedAt).toEqual(NOW);
				expect(writtenUpdate()).not.toHaveProperty('$unset');
				expect(memberBriefsChanges()).toEqual([]);
			});

			it.each(['owner', 'admin'] as const)(
				'CLOSED → OPEN (reopen) unsets closedAt, no counter change (%s)',
				async (by) => {
					await runUpdate(storedBrief({ briefStatus: CLOSED }), { briefStatus: OPEN }, by);

					expect(writtenUpdate()).not.toHaveProperty('closedAt');
					expect(writtenUpdate().$unset).toEqual({ closedAt: 1 });
					expect(memberBriefsChanges()).toEqual([]);
				},
			);

			it.each([
				[OPEN, OPEN],
				[CLOSED, CLOSED],
				[OPEN, undefined],
				[CLOSED, undefined],
			])('%s → %s is no change: no closedAt, deletedAt or $unset', async (current, next) => {
				await runUpdate(storedBrief({ briefStatus: current }), { briefStatus: next });

				expect(writtenUpdate()).not.toHaveProperty('closedAt');
				expect(writtenUpdate()).not.toHaveProperty('deletedAt');
				expect(writtenUpdate()).not.toHaveProperty('$unset');
				expect(memberBriefsChanges()).toEqual([]);
			});

			it.each([OPEN, CLOSED])(
				'%s → DELETE sets deletedAt and subtracts 1 from memberBriefs, for the owner and the admin',
				async (current) => {
					for (const by of ['owner', 'admin'] as const) {
						briefModel.findOneAndUpdate.mockClear();
						memberService.memberStatsEditor.mockClear();
						await runUpdate(storedBrief({ briefStatus: current }), { briefStatus: DELETE }, by);

						expect(writtenUpdate().deletedAt).toEqual(NOW);
						expect(memberService.memberStatsEditor).toHaveBeenCalledTimes(1);
						expect(memberService.memberStatsEditor).toHaveBeenCalledWith({
							_id: ownerId,
							targetKey: 'memberBriefs',
							modifier: -1,
						});
					}
				},
			);

			it.each([OPEN, CLOSED, DELETE, undefined])('DELETE is final: DELETE → %s is rejected', (next) => {
				// unreachable through the update path, which never reads a deleted brief; the table itself still refuses it
				const checkStatusChange = (current: BriefStatus, nextStatus?: BriefStatus) =>
					service['checkStatusChange'](current, nextStatus);

				if (next === DELETE || next === undefined) {
					expect(checkStatusChange(DELETE, next)).toBeNull(); // same status / none: no change
				} else {
					expect(() => checkStatusChange(DELETE, next)).toThrow(Message.INVALID_BRIEF_STATUS_CHANGE);
				}
			});
		});

		describe('compare-and-set (D-30)', () => {
			it('pins the write to the status that was read', async () => {
				await runUpdate(storedBrief({ briefStatus: CLOSED }), { briefStatus: OPEN });

				expect(writeFilter()).toEqual({ _id: briefId, memberId: ownerId, briefStatus: CLOSED });
			});

			it('a concurrent change (the write matches nothing) → NOT_FOUND UPDATE_FAILED, no counter change', async () => {
				briefModel.resolve('findOne', storedBrief()).resolve('findOneAndUpdate', null);
				const update = { _id: briefId, briefStatus: DELETE } as BriefUpdate;

				await expectHttpError(service.updateBrief(ownerId, update), NotFoundException, Message.UPDATE_FAILED);
				expect(memberService.memberStatsEditor).not.toHaveBeenCalled();
			});
		});

		describe('briefBudget (D-04)', () => {
			it('a new budget is written', async () => {
				await runUpdate(storedBrief(), { briefBudget: 300 });

				expect(writtenUpdate()).toMatchObject({ briefBudget: 300 });
			});

			it('null clears it with $unset, never a stored null', async () => {
				await runUpdate(storedBrief(), { briefBudget: null as unknown as number });

				expect(writtenUpdate()).not.toHaveProperty('briefBudget');
				expect(writtenUpdate().$unset).toEqual({ briefBudget: 1 });
			});

			it.each([0, -1])('%p → INVALID_BUDGET, nothing written', async (briefBudget) => {
				await expectHttpError(runUpdate(storedBrief(), { briefBudget }), BadRequestException, Message.INVALID_BUDGET);
				expect(briefModel.findOneAndUpdate).not.toHaveBeenCalled();
			});
		});

		describe('briefDeadline (D-31)', () => {
			const nullDeadline = null as unknown as Date;

			describe('a deadline in the input must be in the future', () => {
				it('a future deadline is written', async () => {
					await runUpdate(storedBrief(), { briefDeadline: FUTURE });

					expect(writtenUpdate()).toMatchObject({ briefDeadline: FUTURE });
				});

				it.each([
					['a past deadline', PAST],
					['a deadline of exactly now', NOW],
				])('%s → DEADLINE_IN_PAST, nothing written', async (_label, briefDeadline) => {
					await expectHttpError(
						runUpdate(storedBrief(), { briefDeadline }),
						BadRequestException,
						Message.DEADLINE_IN_PAST,
					);
					expect(briefModel.findOneAndUpdate).not.toHaveBeenCalled();
				});

				it('null clears it with $unset, even when the stored deadline has passed', async () => {
					await runUpdate(storedBrief({ briefDeadline: PAST }), { briefDeadline: nullDeadline });

					expect(writtenUpdate()).not.toHaveProperty('briefDeadline');
					expect(writtenUpdate().$unset).toEqual({ briefDeadline: 1 });
				});
			});

			describe('a passed stored deadline never blocks ordinary changes', () => {
				it.each([
					['editing the title of an OPEN brief', OPEN, { briefTitle: 'New title' }],
					['editing the title of a CLOSED brief', CLOSED, { briefTitle: 'New title' }],
					['closing it', OPEN, { briefStatus: CLOSED }],
					['deleting an OPEN brief', OPEN, { briefStatus: DELETE }],
					['deleting a CLOSED brief', CLOSED, { briefStatus: DELETE }],
				])('%s', async (_label, current, input) => {
					await runUpdate(storedBrief({ briefStatus: current, briefDeadline: PAST }), input);

					expect(briefModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
				});
			});

			describe('reopening checks the final deadline: empty or in the future', () => {
				it.each(['owner', 'admin'] as const)(
					'reopening with a passed stored deadline and none sent → DEADLINE_IN_PAST (%s)',
					async (by) => {
						const stored = storedBrief({ briefStatus: CLOSED, briefDeadline: PAST });

						await expectHttpError(
							runUpdate(stored, { briefStatus: OPEN }, by),
							BadRequestException,
							Message.DEADLINE_IN_PAST,
						);
						expect(briefModel.findOneAndUpdate).not.toHaveBeenCalled();
					},
				);

				it('reopening with a passed stored deadline and a new future one → OK', async () => {
					await runUpdate(storedBrief({ briefStatus: CLOSED, briefDeadline: PAST }), {
						briefStatus: OPEN,
						briefDeadline: FUTURE,
					});

					expect(writtenUpdate()).toMatchObject({ briefStatus: OPEN, briefDeadline: FUTURE });
					expect(writtenUpdate().$unset).toEqual({ closedAt: 1 });
				});

				it('reopening with a passed stored deadline and null → OK, the deadline is cleared', async () => {
					await runUpdate(storedBrief({ briefStatus: CLOSED, briefDeadline: PAST }), {
						briefStatus: OPEN,
						briefDeadline: nullDeadline,
					});

					expect(writtenUpdate().$unset).toEqual({ briefDeadline: 1, closedAt: 1 });
				});

				it.each([
					['no stored deadline', undefined],
					['a future stored deadline', FUTURE],
				])('reopening with %s → OK', async (_label, briefDeadline) => {
					await runUpdate(storedBrief({ briefStatus: CLOSED, briefDeadline }), { briefStatus: OPEN });

					expect(briefModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
				});

				it('reopening with a past deadline sent → DEADLINE_IN_PAST', async () => {
					await expectHttpError(
						runUpdate(storedBrief({ briefStatus: CLOSED }), { briefStatus: OPEN, briefDeadline: PAST }),
						BadRequestException,
						Message.DEADLINE_IN_PAST,
					);
				});
			});
		});
	});

	describe('isBriefVisible (D-30)', () => {
		it.each([
			[OPEN, true],
			[CLOSED, true],
			[DELETE, false],
		])('%s → %p', (briefStatus, visible) => {
			expect(service.isBriefVisible({ briefStatus })).toBe(visible);
		});
	});

	describe('getBrief', () => {
		it.each([
			['a guest', null],
			['the owner', ownerId],
		])('%s gets NOT_FOUND for a deleted brief, like a missing one (D-30)', async (_label, memberId) => {
			briefModel.resolve('findOne', fullBrief({ briefStatus: DELETE }));

			await expectHttpError(service.getBrief(memberId, briefId), NotFoundException, Message.NO_DATA_FOUND);
		});

		it('a missing brief → NOT_FOUND', async () => {
			await expectHttpError(service.getBrief(null, briefId), NotFoundException, Message.NO_DATA_FOUND);
		});

		it.each([OPEN, CLOSED])(
			'a guest sees a %s brief, with the owner as memberData, and records no view',
			async (status) => {
				briefModel.resolve('findOne', fullBrief({ briefStatus: status }));
				const result = await service.getBrief(null, briefId);

				expect(result.briefStatus).toBe(status);
				expect(result.memberData).toEqual({ _id: ownerId, memberNick: 'owner' });
				expect(viewService.recordView).not.toHaveBeenCalled();
			},
		);

		it("another member's first view of an OPEN brief is recorded and counted once", async () => {
			briefModel.resolve('findOne', fullBrief()).resolve('findByIdAndUpdate', fullBrief());
			viewService.recordView.mockResolvedValue(true);
			const result = await service.getBrief(otherId, briefId, MemberType.USER);

			expect(viewService.recordView).toHaveBeenCalledWith(
				{ memberId: otherId, viewRefId: briefId, viewGroup: ViewGroup.BRIEF },
				MemberType.USER,
			);
			expect(briefModel.findByIdAndUpdate).toHaveBeenCalledWith(briefId, { $inc: { briefViews: 1 } }, { new: true });
			expect(result.briefViews).toBe(4);
		});

		it("another member's repeat view doesn't change briefViews (D-18)", async () => {
			briefModel.resolve('findOne', fullBrief());
			const result = await service.getBrief(otherId, briefId);

			expect(briefModel.findByIdAndUpdate).not.toHaveBeenCalled();
			expect(result.briefViews).toBe(3);
		});

		it.each([
			['the owner of an OPEN brief (D-22)', OPEN, ownerId],
			['another member on a CLOSED brief (D-30)', CLOSED, otherId],
		])('records no view for %s', async (_label, status, memberId) => {
			briefModel.resolve('findOne', fullBrief({ briefStatus: status }));
			await service.getBrief(memberId, briefId);

			expect(viewService.recordView).not.toHaveBeenCalled();
			expect(briefModel.findByIdAndUpdate).not.toHaveBeenCalled();
		});
	});

	describe('brief lists (D-30)', () => {
		const inquiry = { page: 1, limit: 10, search: {} };
		const pipeline = () => briefModel.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
		const match = () => pipeline()[0].$match as Record<string, unknown>;

		beforeEach(() => {
			briefModel.resolve('aggregate', [{ list: [], metaCounter: [] }]);
		});

		it('getBriefs lists only OPEN briefs by default, also for a member profile', async () => {
			await service.getBriefs({ ...inquiry, search: { memberId: ownerId } });

			expect(match()).toEqual({ briefStatus: OPEN, memberId: ownerId });
		});

		it('getBriefs lists CLOSED briefs on request', async () => {
			await service.getBriefs({ ...inquiry, search: { briefStatus: CLOSED } });

			expect(match()).toEqual({ briefStatus: CLOSED });
		});

		it("getMyBriefs lists the caller's OPEN and CLOSED briefs by default", async () => {
			await service.getMyBriefs(ownerId, inquiry);

			expect(match()).toEqual({ memberId: ownerId, briefStatus: { $ne: DELETE } });
		});

		it('getMyBriefs can filter one status', async () => {
			await service.getMyBriefs(ownerId, { ...inquiry, search: { briefStatus: CLOSED } });

			expect(match()).toEqual({ memberId: ownerId, briefStatus: CLOSED });
		});

		it('getBriefs and getMyBriefs reject DELETE with BAD_REQUEST', async () => {
			const search = { briefStatus: DELETE };

			await expectHttpError(service.getBriefs({ ...inquiry, search }), BadRequestException, Message.NO_DATA_FOUND);
			await expectHttpError(
				service.getMyBriefs(ownerId, { ...inquiry, search }),
				BadRequestException,
				Message.NO_DATA_FOUND,
			);
			expect(briefModel.aggregate).not.toHaveBeenCalled();
		});

		it('getAllBriefsByAdmin lists every status, DELETE included, unless one is asked for', async () => {
			await service.getAllBriefsByAdmin(inquiry);
			expect(match()).toEqual({});

			briefModel.aggregate.mockClear();
			briefModel.resolve('aggregate', [{ list: [], metaCounter: [] }]);
			await service.getAllBriefsByAdmin({ ...inquiry, search: { briefStatus: DELETE } });
			expect(match()).toEqual({ briefStatus: DELETE });
		});

		it('filters by category and escapes the title search (S8)', async () => {
			const search = { categoryList: [AgentCategory.SALES], text: 'a.b(' };
			await service.getBriefs({ ...inquiry, search });

			expect(match()).toEqual({
				briefStatus: OPEN,
				briefCategory: { $in: [AgentCategory.SALES] },
				briefTitle: { $regex: /a\.b\(/i },
			});
		});

		describe('budget type filter (D-44)', () => {
			it.each([
				[[FIXED], { $type: 'number' }],
				[[OPEN_TO_OFFERS], { $not: { $type: 'number' } }],
			])('%p matches on briefBudget', async (budgetTypeList, briefBudget) => {
				await service.getBriefs({ ...inquiry, search: { budgetTypeList } });

				expect(match()).toEqual({ briefStatus: OPEN, briefBudget });
			});

			it('both types, or an empty list, are no filter', async () => {
				await service.getBriefs({ ...inquiry, search: { budgetTypeList: [FIXED, OPEN_TO_OFFERS] } });
				briefModel.resolve('aggregate', [{ list: [], metaCounter: [] }]);
				await service.getBriefs({ ...inquiry, search: { budgetTypeList: [] } });

				for (const [stages] of briefModel.aggregate.mock.calls as Array<[Array<Record<string, unknown>>]>) {
					expect(stages[0]).toEqual({ $match: { briefStatus: OPEN } });
				}
			});

			it('the owner and admin lists take it too', async () => {
				await service.getMyBriefs(ownerId, { ...inquiry, search: { budgetTypeList: [FIXED] } });

				expect(match()).toEqual({ memberId: ownerId, briefStatus: { $ne: DELETE }, briefBudget: { $type: 'number' } });
			});
		});

		describe('hidePastDeadline (D-44)', () => {
			it('leaves out OPEN briefs whose deadline is not later than now', async () => {
				await service.getBriefs({ ...inquiry, search: { hidePastDeadline: true } });

				expect(match()).toEqual({ briefStatus: OPEN, ...notPast });
			});

			it('has no effect on the CLOSED list, or when false', async () => {
				await service.getBriefs({ ...inquiry, search: { briefStatus: CLOSED, hidePastDeadline: true } });
				expect(match()).toEqual({ briefStatus: CLOSED });

				briefModel.aggregate.mockClear();
				briefModel.resolve('aggregate', [{ list: [], metaCounter: [] }]);
				await service.getBriefs({ ...inquiry, search: { hidePastDeadline: false } });
				expect(match()).toEqual({ briefStatus: OPEN });
			});
		});

		describe('sorting by budget or deadline puts briefs without one last, in both directions (D-04, D-05)', () => {
			it.each([
				['briefBudget', Direction.ASC, { $isNumber: '$briefBudget' }],
				['briefBudget', Direction.DESC, { $isNumber: '$briefBudget' }],
				['briefDeadline', Direction.DESC, { $eq: [{ $type: '$briefDeadline' }, 'date'] }],
			])('%s, direction %p', async (sort, direction, hasValue) => {
				await service.getBriefs({ ...inquiry, sort, direction });

				expect(pipeline()[1]).toEqual({ $addFields: { _hasValue: { $cond: [hasValue, 1, 0] } } });
				expect(pipeline()[2]).toEqual({ $sort: { _hasValue: -1, [sort]: direction, _id: -1 } });
			});

			it('other sorts sort directly, newest _id breaking ties', async () => {
				await service.getBriefs({ ...inquiry, sort: 'briefViews', direction: Direction.DESC });

				expect(pipeline()[1]).toEqual({ $sort: { briefViews: Direction.DESC, _id: -1 } });
			});
		});

		it('briefDeadline ASC ("deadline soonest") lists upcoming, then passed, then none, each nearest to now first (D-44)', async () => {
			await service.getBriefs({ ...inquiry, sort: 'briefDeadline', direction: Direction.ASC });

			expect(pipeline()[1]).toEqual({
				$addFields: {
					_deadlineRank: {
						$switch: {
							branches: [
								{ case: { $ne: [{ $type: '$briefDeadline' }, 'date'] }, then: 2 },
								{ case: { $lte: ['$briefDeadline', NOW] }, then: 1 },
							],
							default: 0,
						},
					},
					_deadlineGap: { $abs: { $subtract: ['$briefDeadline', NOW] } },
				},
			});
			expect(pipeline()[2]).toEqual({ $sort: { _deadlineRank: 1, _deadlineGap: 1, _id: -1 } });
			expect(pipeline()[3]).toEqual({ $unset: ['_deadlineRank', '_deadlineGap'] });
		});

		it('briefComments ("most discussed") breaks ties by briefViews (D-44)', async () => {
			await service.getBriefs({ ...inquiry, sort: 'briefComments', direction: Direction.DESC });

			expect(pipeline()[1]).toEqual({
				$sort: { briefComments: Direction.DESC, briefViews: Direction.DESC, _id: -1 },
			});
		});
	});

	describe('getBriefFacets (D-44)', () => {
		const pipeline = () => briefModel.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
		const facets = () => pipeline()[1].$facet as Record<string, Array<Record<string, unknown>>>;
		const group = (by: unknown) => ({ $group: { _id: by, count: { $sum: 1 } } });
		const byBudgetType = {
			$cond: [{ $isNumber: '$briefBudget' }, FIXED, OPEN_TO_OFFERS],
		};

		const noCounts = () => briefModel.resolve('aggregate', [{ categories: [], budgetTypes: [], statuses: [] }]);

		it('lists every category, both budget types and OPEN / CLOSED in order, 0 when nothing matches', async () => {
			briefModel.resolve('aggregate', [
				{
					categories: [{ _id: AgentCategory.SALES, count: 2 }],
					budgetTypes: [{ _id: OPEN_TO_OFFERS, count: 1 }],
					statuses: [{ _id: CLOSED, count: 4 }],
				},
			]);

			const result = await service.getBriefFacets({});

			expect(result.categories.map((facet) => facet.value)).toEqual(Object.values(AgentCategory));
			expect(result.categories.find((facet) => facet.value === AgentCategory.SALES)?.count).toBe(2);
			expect(result.categories.find((facet) => facet.value === AgentCategory.OTHER)?.count).toBe(0);
			expect(result.budgetTypes).toEqual([
				{ value: FIXED, count: 0 },
				{ value: OPEN_TO_OFFERS, count: 1 },
			]);
			expect(result.statuses).toEqual([
				{ value: OPEN, count: 0 },
				{ value: CLOSED, count: 4 },
			]);
		});

		it('counts OPEN and CLOSED only (never DELETE); categories and budgets count the chosen status (OPEN by default)', async () => {
			noCounts();
			await service.getBriefFacets({});

			expect(pipeline()[0]).toEqual({ $match: { briefStatus: { $in: [OPEN, CLOSED] } } });
			expect(facets()).toEqual({
				categories: [{ $match: { briefStatus: OPEN } }, group('$briefCategory')],
				budgetTypes: [{ $match: { briefStatus: OPEN } }, group(byBudgetType)],
				statuses: [group('$briefStatus')],
			});
		});

		it('each group ignores its own filter and applies the others', async () => {
			noCounts();
			await service.getBriefFacets({
				memberId: ownerId,
				text: 'bot',
				categoryList: [AgentCategory.SALES],
				budgetTypeList: [FIXED],
				briefStatus: CLOSED,
			});

			// Shared: the filters no group owns.
			expect(pipeline()[0]).toEqual({
				$match: { briefStatus: { $in: [OPEN, CLOSED] }, memberId: ownerId, briefTitle: { $regex: /bot/i } },
			});
			const budget = { briefBudget: { $type: 'number' } };
			const category = { briefCategory: { $in: [AgentCategory.SALES] } };
			expect(facets()).toEqual({
				categories: [{ $match: { briefStatus: CLOSED, ...budget } }, group('$briefCategory')],
				budgetTypes: [{ $match: { briefStatus: CLOSED, ...category } }, group(byBudgetType)],
				statuses: [{ $match: { ...category, ...budget } }, group('$briefStatus')],
			});
		});

		it('hidePastDeadline drops past-deadline briefs from the OPEN counts only', async () => {
			noCounts();
			await service.getBriefFacets({ hidePastDeadline: true });

			expect(facets().categories[0]).toEqual({ $match: { briefStatus: OPEN, ...notPast } });
			expect(facets().budgetTypes[0]).toEqual({ $match: { briefStatus: OPEN, ...notPast } });
			// CLOSED briefs are counted whatever their deadline
			expect(facets().statuses[0]).toEqual({ $match: { $or: [{ briefStatus: CLOSED }, notPast] } });

			briefModel.aggregate.mockClear();
			noCounts();
			await service.getBriefFacets({ hidePastDeadline: true, briefStatus: CLOSED });
			expect(facets().categories[0]).toEqual({ $match: { briefStatus: CLOSED } });
		});

		it('DELETE → BAD_REQUEST, before the database is asked (D-30)', async () => {
			await expectHttpError(
				service.getBriefFacets({ briefStatus: DELETE }),
				BadRequestException,
				Message.NO_DATA_FOUND,
			);
			expect(briefModel.aggregate).not.toHaveBeenCalled();
		});

		it('an empty aggregation result gives all zeros', async () => {
			briefModel.resolve('aggregate', []);

			const result = await service.getBriefFacets({});

			expect([...result.categories, ...result.budgetTypes, ...result.statuses].every((f) => f.count === 0)).toBe(true);
		});
	});

	describe('getOpenBriefStats (D-44)', () => {
		it('counts OPEN briefs not past their deadline and sums their budgets, rounded to cents', async () => {
			briefModel.resolve('aggregate', [{ _id: null, openNow: 3, budgetTotal: 2450.1 + 0.2 }]);

			expect(await service.getOpenBriefStats()).toEqual({ openNow: 3, budgetTotal: 2450.3 });
			expect(briefModel.aggregate.mock.calls[0][0]).toEqual([
				{ $match: { briefStatus: OPEN, ...notPast } },
				{ $group: { _id: null, openNow: { $sum: 1 }, budgetTotal: { $sum: '$briefBudget' } } },
			]);
		});

		it('no open briefs → zeros', async () => {
			briefModel.resolve('aggregate', []);

			expect(await service.getOpenBriefStats()).toEqual({ openNow: 0, budgetTotal: 0 });
		});
	});

	describe('removeBriefByAdmin (D-30, D-28 principle)', () => {
		it('hard-deletes only a brief already set to DELETE, with no counter change', async () => {
			briefModel.resolve('findOneAndDelete', fullBrief({ briefStatus: DELETE }));
			await service.removeBriefByAdmin(briefId);

			expect(briefModel.findOneAndDelete).toHaveBeenCalledWith({ _id: briefId, briefStatus: DELETE });
			expect(memberService.memberStatsEditor).not.toHaveBeenCalled();
		});

		it('an OPEN, CLOSED or missing brief → NOT_FOUND REMOVE_FAILED', async () => {
			await expectHttpError(service.removeBriefByAdmin(briefId), NotFoundException, Message.REMOVE_FAILED);
		});
	});
});
