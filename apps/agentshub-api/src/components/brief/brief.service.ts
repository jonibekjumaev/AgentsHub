import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HydratedDocument, Model, PipelineStage, UpdateQuery } from 'mongoose';
import moment from 'moment';
import { Brief, BriefFacets, Briefs, OpenBriefStats } from '../../libs/dto/brief/brief';
import {
	AllBriefsInquiry,
	BISearch,
	BriefFilters,
	BriefInput,
	BriefsInquiry,
	MyBriefsInquiry,
} from '../../libs/dto/brief/brief.input';
import { BriefUpdate } from '../../libs/dto/brief/brief.update';
import { BriefBudgetType, BriefStatus } from '../../libs/enums/brief.enum';
import { AgentCategory } from '../../libs/enums/agent-category.enum';
import { Direction, Message } from '../../libs/enums/common.enum';
import { escapeRegex, lookupMember, shapeInToMongoObjectId, unwindKeepingItem } from '../../libs/config';
import { ViewGroup } from '../../libs/enums/view.enum';
import { ObjectId, StatisticModifier, T } from '../../libs/types/common';
import { ViewInput } from '../../libs/dto/view/view.input';
import { MemberService } from '../member/member.service';
import { ViewService } from '../view/view.service';
import { describeDbError } from '../../libs/utils';
import { MemberType } from '../../libs/enums/member.enum';

type FacetRow = { _id: string; count: number };

const countOf = (rows: FacetRow[], value: string): number => rows.find((row) => row._id === value)?.count ?? 0;

/** The statuses the public lists and counts show (D-30); DELETE never. */
const listedStatuses = [BriefStatus.OPEN, BriefStatus.CLOSED];

/** D-44: a deadline has passed when it is not later than now (the D-05 rule, turned around). */
const notPastDeadline = (now: Date): T => ({ briefDeadline: { $not: { $lte: now } } });

/** D-44: FIXED / OPEN_TO_OFFERS, the same test as the budget sort (`$isNumber`, D-04). */
const budgetTypeOf = { $cond: [{ $isNumber: '$briefBudget' }, BriefBudgetType.FIXED, BriefBudgetType.OPEN_TO_OFFERS] };

@Injectable()
export class BriefService {
	constructor(
		@InjectModel('Brief') private readonly briefModel: Model<Brief>,
		private memberService: MemberService,
		private viewService: ViewService,
	) {}

	public async createBrief(input: BriefInput): Promise<Brief> {
		this.checkBudgetRule(input.briefBudget);
		this.checkDeadlineRule(input.briefDeadline);
		// no budget / deadline is stored as a missing field, not null (D-04, D-05)
		if (input.briefBudget === null) delete input.briefBudget;
		if (input.briefDeadline === null) delete input.briefDeadline;
		let result: HydratedDocument<Brief>;
		try {
			result = await this.briefModel.create(input);
		} catch (err) {
			console.log('Error: Service.model', describeDbError(err));
			throw new BadRequestException(Message.CREATE_FAILED);
		}

		// outside the catch: the brief exists, so a counter failure is a server error, not CREATE_FAILED (B20)
		await this.memberService.memberStatsEditor({
			_id: result.memberId,
			targetKey: 'memberBriefs',
			modifier: 1,
		});
		return result;
	}

	public async getBrief(
		memberId: ObjectId | null,
		briefId: ObjectId,
		viewerType: MemberType | null = null,
	): Promise<Brief> {
		const targetBrief = await this.briefModel.findOne({ _id: briefId }).lean().exec();
		// a brief the caller may not see gets the same answer as a missing one (D-30)
		if (!targetBrief || !this.isBriefVisible(targetBrief)) throw new NotFoundException(Message.NO_DATA_FOUND);

		// views only on an OPEN brief, by a logged-in member who is not the owner (D-30, D-22)
		const isOpen = targetBrief.briefStatus === BriefStatus.OPEN;
		if (memberId && isOpen && !memberId.equals(targetBrief.memberId)) {
			const viewInput: ViewInput = { memberId: memberId, viewRefId: briefId, viewGroup: ViewGroup.BRIEF };
			const newView = await this.viewService.recordView(viewInput, viewerType); // admins' views never count (D-42)
			if (newView) {
				await this.briefStatsEditor({ _id: briefId, targetKey: 'briefViews', modifier: 1 });
				targetBrief.briefViews++;
			}
		}

		targetBrief.memberData = (await this.memberService.getAuthorData(targetBrief.memberId)) ?? undefined; // D-38
		return targetBrief;
	}

	public async updateBrief(memberId: ObjectId, input: BriefUpdate): Promise<Brief> {
		return await this.applyBriefUpdate({ _id: input._id, memberId: memberId }, input);
	}

	/** D-30: the public list (also another member's profile) shows OPEN by default, or CLOSED on request; never DELETE. */
	public async getBriefs(input: BriefsInquiry): Promise<Briefs> {
		const { briefStatus } = input.search;
		if (briefStatus === BriefStatus.DELETE) throw new BadRequestException(Message.NO_DATA_FOUND);

		const match: T = { briefStatus: briefStatus ?? BriefStatus.OPEN };
		this.shapeMatchQuery(match, input.search);
		// D-44: only OPEN briefs can be past their deadline in a useful sense; CLOSED ones are listed as they are
		if (input.search.hidePastDeadline && match.briefStatus === BriefStatus.OPEN) {
			Object.assign(match, notPastDeadline(new Date()));
		}
		return await this.aggregateBriefs(match, input);
	}

	/**
	 * D-44: live counts for the /briefs filters, with the same rules as getBriefs. Each group ignores its own filter:
	 * the category counts use every filter but categoryList, the budget counts every filter but budgetTypeList, the
	 * status counts every filter but briefStatus (hidePastDeadline still applies to the OPEN count only).
	 *
	 * One aggregation, as in getProductFacets (D-43): the filters every group shares (memberId, text) go into the first
	 * $match, then each $facet branch adds the other groups' filters and counts.
	 */
	public async getBriefFacets(search: BISearch): Promise<BriefFacets> {
		const { briefStatus, categoryList, budgetTypeList, hidePastDeadline } = search;
		if (briefStatus === BriefStatus.DELETE) throw new BadRequestException(Message.NO_DATA_FOUND);

		const now = new Date();
		const status = briefStatus ?? BriefStatus.OPEN;
		const shared: T = { briefStatus: { $in: listedStatuses } };
		this.shapeMatchQuery(shared, { memberId: search.memberId, text: search.text });

		// Each group's own filter, as shapeMatchQuery would write it; {} when it is not set.
		const byCategory: T = {};
		this.shapeMatchQuery(byCategory, { categoryList });
		const byBudget: T = {};
		this.shapeMatchQuery(byBudget, { budgetTypeList });
		const byStatus: T = {
			briefStatus: status,
			...(hidePastDeadline && status === BriefStatus.OPEN ? notPastDeadline(now) : {}),
		};
		// The status counts: the past-deadline rule applies to OPEN briefs only.
		const hidePastFromOpen: T = hidePastDeadline
			? { $or: [{ briefStatus: BriefStatus.CLOSED }, notPastDeadline(now)] }
			: {};

		const branch = (extra: T, groupBy: unknown): PipelineStage.FacetPipelineStage[] => [
			...(Object.keys(extra).length ? [{ $match: extra }] : []),
			{ $group: { _id: groupBy, count: { $sum: 1 } } },
		];

		const result = await this.briefModel
			.aggregate<{ categories: FacetRow[]; budgetTypes: FacetRow[]; statuses: FacetRow[] }>([
				{ $match: shared },
				{
					$facet: {
						categories: branch({ ...byStatus, ...byBudget }, '$briefCategory'),
						budgetTypes: branch({ ...byStatus, ...byCategory }, budgetTypeOf),
						statuses: branch({ ...byCategory, ...byBudget, ...hidePastFromOpen }, '$briefStatus'),
					},
				},
			])
			.exec();
		const counts = result[0] ?? { categories: [], budgetTypes: [], statuses: [] };

		return {
			categories: Object.values(AgentCategory).map((value) => ({ value, count: countOf(counts.categories, value) })),
			budgetTypes: Object.values(BriefBudgetType).map((value) => ({
				value,
				count: countOf(counts.budgetTypes, value),
			})),
			statuses: listedStatuses.map((value) => ({ value, count: countOf(counts.statuses, value) })),
		};
	}

	/**
	 * D-44: the /briefs live badge, over the whole site (no filters): OPEN briefs whose deadline has not passed, and the
	 * sum of their fixed budgets (open-to-offers briefs add nothing). Both numbers come from the same briefs.
	 */
	public async getOpenBriefStats(): Promise<OpenBriefStats> {
		const result = await this.briefModel
			.aggregate<{ openNow: number; budgetTotal: number }>([
				{ $match: { briefStatus: BriefStatus.OPEN, ...notPastDeadline(new Date()) } },
				// $sum skips briefs without a briefBudget (D-04)
				{ $group: { _id: null, openNow: { $sum: 1 }, budgetTotal: { $sum: '$briefBudget' } } },
			])
			.exec();
		const stats = result[0];
		if (!stats) return { openNow: 0, budgetTotal: 0 };

		// floating-point sums like 0.1 + 0.2 are rounded back to cents
		return { openNow: stats.openNow, budgetTotal: Math.round(stats.budgetTotal * 100) / 100 };
	}

	/** D-30: the owner's list shows OPEN and CLOSED, or one of them on request; never DELETE. */
	public async getMyBriefs(memberId: ObjectId, input: MyBriefsInquiry): Promise<Briefs> {
		const { briefStatus } = input.search;
		if (briefStatus === BriefStatus.DELETE) throw new BadRequestException(Message.NO_DATA_FOUND);

		const match: T = { memberId, briefStatus: briefStatus ?? { $ne: BriefStatus.DELETE } };
		this.shapeMatchQuery(match, input.search);
		return await this.aggregateBriefs(match, input);
	}

	/** D-30: the admin list shows every status, DELETE included, or one status on request. */
	public async getAllBriefsByAdmin(input: AllBriefsInquiry): Promise<Briefs> {
		const { briefStatus } = input.search;
		const match: T = {};

		if (briefStatus) match.briefStatus = briefStatus;
		this.shapeMatchQuery(match, input.search);
		return await this.aggregateBriefs(match, input);
	}

	public async updateBriefByAdmin(input: BriefUpdate): Promise<Brief> {
		// admins may make the same changes as the owner, with the same transition table and deadline rule (D-30, D-31)
		return await this.applyBriefUpdate({ _id: input._id }, input);
	}

	/**
	 * Hard delete, only for briefs already DELETE (D-30, D-28 principle). No counter change: memberBriefs was already
	 * decremented when the brief was set to DELETE.
	 */
	public async removeBriefByAdmin(briefId: ObjectId): Promise<Brief> {
		const result = await this.briefModel.findOneAndDelete({ _id: briefId, briefStatus: BriefStatus.DELETE }).exec();
		if (!result) throw new NotFoundException(Message.REMOVE_FAILED);
		return result;
	}

	public async briefStatsEditor(input: StatisticModifier): Promise<Brief> {
		const { _id, targetKey, modifier } = input;
		const result = await this.briefModel
			.findByIdAndUpdate(
				_id,
				{
					$inc: { [targetKey]: modifier },
				},
				{ new: true },
			)
			.exec();

		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
		return result;
	}

	/**
	 * D-30 visibility of one brief: OPEN and CLOSED for everyone (guests included), DELETE for nobody (admins see
	 * deleted briefs only in the admin list). Child records (e.g. comments) follow the same rule.
	 */
	public isBriefVisible(brief: Pick<Brief, 'briefStatus'>): boolean {
		return brief.briefStatus !== BriefStatus.DELETE;
	}

	/** The search filters shared by the brief lists. Empty lists mean "no filter". */
	private shapeMatchQuery(match: T, search: BriefFilters & { memberId?: ObjectId }): void {
		const { memberId, categoryList, budgetTypeList, text } = search;

		if (memberId) match.memberId = shapeInToMongoObjectId(memberId);
		if (categoryList?.length) match.briefCategory = { $in: categoryList };
		// D-44: one budget type filters; both types are every brief, so no filter
		const budgetTypes = new Set(budgetTypeList ?? []);
		if (budgetTypes.size === 1) {
			match.briefBudget = budgetTypes.has(BriefBudgetType.FIXED) ? { $type: 'number' } : { $not: { $type: 'number' } };
		}
		if (text) match.briefTitle = { $regex: new RegExp(escapeRegex(text), 'i') };
	}

	/**
	 * The $sort stages of the brief lists. Ties are broken by the newest _id, so skip/limit pages stay stable. Sorting
	 * by briefBudget or briefDeadline puts briefs without one ("open to offers" / no date, D-04, D-05) last in both
	 * directions.
	 *
	 * D-44: briefComments ("most discussed") breaks ties by briefViews. briefDeadline ASC ("deadline soonest") lists the
	 * upcoming deadlines first (soonest first), then the passed ones (most recently passed first), then briefs without
	 * one: a plain ascending date would put long-passed deadlines on top.
	 */
	private shapeSortStages(sort: string = 'createdAt', direction: Direction = Direction.DESC): PipelineStage[] {
		if (sort === 'briefComments') {
			return [{ $sort: { briefComments: direction, briefViews: direction, _id: -1 } }];
		}
		if (sort === 'briefDeadline' && direction === Direction.ASC) {
			const now = new Date();
			return [
				{
					$addFields: {
						_deadlineRank: {
							$switch: {
								branches: [
									{ case: { $ne: [{ $type: '$briefDeadline' }, 'date'] }, then: 2 },
									{ case: { $lte: ['$briefDeadline', now] }, then: 1 },
								],
								default: 0,
							},
						},
						// distance from now: soonest upcoming and most recently passed come first in their group
						_deadlineGap: { $abs: { $subtract: ['$briefDeadline', now] } },
					},
				},
				{ $sort: { _deadlineRank: 1, _deadlineGap: 1, _id: -1 } },
				{ $unset: ['_deadlineRank', '_deadlineGap'] },
			];
		}
		const hasValue: T = {
			briefBudget: { $isNumber: '$briefBudget' },
			briefDeadline: { $eq: [{ $type: '$briefDeadline' }, 'date'] },
		};
		if (hasValue[sort]) {
			return [
				{ $addFields: { _hasValue: { $cond: [hasValue[sort], 1, 0] } } },
				{ $sort: { _hasValue: -1, [sort]: direction, _id: -1 } },
				{ $unset: '_hasValue' },
			];
		}
		return [{ $sort: { [sort]: direction, _id: -1 } }];
	}

	/** $match before $facet, so metaCounter counts only the matched statuses (D-16 principle). */
	private async aggregateBriefs(
		match: T,
		input: { page: number; limit: number; sort?: string; direction?: Direction },
	): Promise<Briefs> {
		const result = await this.briefModel
			.aggregate([
				{ $match: match },
				...this.shapeSortStages(input.sort, input.direction),
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							lookupMember,
							unwindKeepingItem('$memberData'),
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0] as Briefs;
	}

	/** D-04, the only place it is checked besides the input validation: a budget, if given, must be > 0. */
	private checkBudgetRule(briefBudget: number | null | undefined): void {
		if (briefBudget !== null && briefBudget !== undefined && !(briefBudget > 0)) {
			throw new BadRequestException(Message.INVALID_BUDGET);
		}
	}

	/** D-05 / D-31, the only place it is checked: a deadline, if given, must be later than now. */
	private checkDeadlineRule(briefDeadline: Date | null | undefined): void {
		if (briefDeadline && !moment(briefDeadline).isAfter(moment())) {
			throw new BadRequestException(Message.DEADLINE_IN_PAST);
		}
	}

	/**
	 * The update shared by updateBrief (search has the owner's memberId) and updateBriefByAdmin (D-30). A
	 * deleted brief is not matched, so it answers like a missing one. The write is pinned to the status that was read
	 * and checked, so a concurrent change (e.g. a second DELETE) matches nothing: memberBriefs is decremented once.
	 */
	private async applyBriefUpdate(search: T, input: BriefUpdate): Promise<Brief> {
		const stored = await this.briefModel
			.findOne({ ...search, briefStatus: { $ne: BriefStatus.DELETE } })
			.select('briefStatus briefDeadline')
			.lean()
			.exec();
		if (!stored) throw new NotFoundException(Message.UPDATE_FAILED);

		const nextStatus = this.checkStatusChange(stored.briefStatus, input.briefStatus);
		this.checkBudgetRule(input.briefBudget);
		// D-31: the deadline is checked when it is sent, and on reopen the final deadline must be empty or in the future
		if (input.briefDeadline !== undefined) this.checkDeadlineRule(input.briefDeadline);
		if (nextStatus === BriefStatus.OPEN) {
			this.checkDeadlineRule(input.briefDeadline !== undefined ? input.briefDeadline : stored.briefDeadline);
		}

		const update: UpdateQuery<Brief> = { ...input };
		const unset: T = {};
		// null clears the budget / deadline: $unset, not a stored null
		if (input.briefBudget === null) {
			delete update.briefBudget;
			unset.briefBudget = 1;
		}
		if (input.briefDeadline === null) {
			delete update.briefDeadline;
			unset.briefDeadline = 1;
		}
		if (nextStatus === BriefStatus.CLOSED) update.closedAt = moment().toDate();
		if (nextStatus === BriefStatus.OPEN) unset.closedAt = 1;
		if (nextStatus === BriefStatus.DELETE) update.deletedAt = moment().toDate();
		if (Object.keys(unset).length) update.$unset = unset;

		const result = await this.briefModel
			.findOneAndUpdate({ ...search, briefStatus: stored.briefStatus }, update, { new: true })
			.exec();
		if (!result) throw new NotFoundException(Message.UPDATE_FAILED); // the status changed since it was read

		// memberBriefs counts OPEN + CLOSED: only a change to DELETE decrements it, close/reopen don't (D-30)
		if (nextStatus === BriefStatus.DELETE) {
			await this.memberService.memberStatsEditor({
				_id: result.memberId,
				targetKey: 'memberBriefs',
				modifier: -1,
			});
		}
		return result;
	}

	/**
	 * D-30 status changes: OPEN <-> CLOSED, OPEN | CLOSED -> DELETE; DELETE is final. The same status (or none) is no
	 * change. Returns the new status, or null when the status doesn't change.
	 */
	private checkStatusChange(current: BriefStatus, next: BriefStatus | undefined): BriefStatus | null {
		if (next === undefined || next === current) return null;

		const isAllowed =
			(current === BriefStatus.OPEN && next === BriefStatus.CLOSED) ||
			(current === BriefStatus.CLOSED && next === BriefStatus.OPEN) ||
			(current !== BriefStatus.DELETE && next === BriefStatus.DELETE);
		if (!isAllowed) throw new BadRequestException(Message.INVALID_BRIEF_STATUS_CHANGE);
		return next;
	}
}
