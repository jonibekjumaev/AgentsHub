import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HydratedDocument, Model, PipelineStage, UpdateQuery } from 'mongoose';
import moment from 'moment';
import { Brief, Briefs } from '../../libs/dto/brief/brief';
import {
	AllBriefsInquiry,
	BriefFilters,
	BriefInput,
	BriefsInquiry,
	MyBriefsInquiry,
} from '../../libs/dto/brief/brief.input';
import { BriefUpdate } from '../../libs/dto/brief/brief.update';
import { BriefStatus } from '../../libs/enums/brief.enum';
import { Direction, Message } from '../../libs/enums/common.enum';
import { escapeRegex, lookupMember, shapeInToMongoObjectId } from '../../libs/config';
import { ViewGroup } from '../../libs/enums/view.enum';
import { ObjectId, StatisticModifier, T } from '../../libs/types/common';
import { ViewInput } from '../../libs/dto/view/view.input';
import { MemberService } from '../member/member.service';
import { ViewService } from '../view/view.service';
import { describeDbError } from '../../libs/utils';

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

	public async getBrief(memberId: ObjectId | null, briefId: ObjectId): Promise<Brief> {
		const targetBrief = await this.briefModel.findOne({ _id: briefId }).lean().exec();
		// a brief the caller may not see gets the same answer as a missing one (D-30)
		if (!targetBrief || !this.isBriefVisible(targetBrief)) throw new NotFoundException(Message.NO_DATA_FOUND);

		// views only on an OPEN brief, by a logged-in member who is not the owner (D-30, D-22)
		const isOpen = targetBrief.briefStatus === BriefStatus.OPEN;
		if (memberId && isOpen && !memberId.equals(targetBrief.memberId)) {
			const viewInput: ViewInput = { memberId: memberId, viewRefId: briefId, viewGroup: ViewGroup.BRIEF };
			const newView = await this.viewService.recordView(viewInput);
			if (newView) {
				await this.briefStatsEditor({ _id: briefId, targetKey: 'briefViews', modifier: 1 });
				targetBrief.briefViews++;
			}
		}

		targetBrief.memberData = await this.memberService.getMember(null, targetBrief.memberId);
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
		return await this.aggregateBriefs(match, input);
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
		const { memberId, categoryList, text } = search;

		if (memberId) match.memberId = shapeInToMongoObjectId(memberId);
		if (categoryList?.length) match.briefCategory = { $in: categoryList };
		if (text) match.briefTitle = { $regex: new RegExp(escapeRegex(text), 'i') };
	}

	/**
	 * The $sort stages of the brief lists. Ties are broken by the newest _id, so skip/limit pages stay stable. Sorting
	 * by briefBudget or briefDeadline puts briefs without one ("open to offers" / no date, D-04, D-05) last in both
	 * directions.
	 */
	private shapeSortStages(sort: string = 'createdAt', direction: Direction = Direction.DESC): PipelineStage[] {
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
							{ $unwind: '$memberData' },
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
