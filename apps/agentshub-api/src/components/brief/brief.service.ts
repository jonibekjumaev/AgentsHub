import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, UpdateQuery } from 'mongoose';
import moment from 'moment';
import { Brief } from '../../libs/dto/brief/brief';
import { BriefInput } from '../../libs/dto/brief/brief.input';
import { BriefUpdate } from '../../libs/dto/brief/brief.update';
import { BriefStatus } from '../../libs/enums/brief.enum';
import { Message } from '../../libs/enums/common.enum';
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
		try {
			const result = await this.briefModel.create(input);
			await this.memberService.memberStatsEditor({
				_id: result.memberId,
				targetKey: 'memberBriefs',
				modifier: 1,
			});
			return result;
		} catch (err) {
			console.log('Error: Service.model', describeDbError(err));
			throw new BadRequestException(Message.CREATE_FAILED);
		}
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
	 * The update shared by the owner (search has the owner's memberId) and, from Step 7 part 4, the admin (D-30). A
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
