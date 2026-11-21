import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Invite, Invites } from '../../libs/dto/invite/invite';
import { Brief } from '../../libs/dto/brief/brief';
import { OrdinaryInquiry } from '../../libs/dto/common.input';
import { BriefStatus, visibleBriefStatuses } from '../../libs/enums/brief.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { Message } from '../../libs/enums/common.enum';
import {
	excludeDeletedMember,
	excludeMemberSecrets,
	inviteDailyLimit,
	unwindKeepingItem,
	withoutEmbedding,
} from '../../libs/config';
import { describeDbError, isDuplicateKeyError } from '../../libs/utils';
import type { ObjectId } from '../../libs/types/common';
import { MemberService } from '../member/member.service';
import { NotificationService } from '../notification/notification.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * D-48: invites ("invite to job"). The brief's owner asks a creator to send an offer; the price and days still come
 * from the creator's offer. Idempotent like saveBrief (D-47): inviting the same creator again changes nothing.
 */
@Injectable()
export class InviteService {
	constructor(
		@InjectModel('Invite') private readonly inviteModel: Model<Invite>,
		@InjectModel('Brief') private readonly briefModel: Model<Brief>,
		private readonly memberService: MemberService,
		private readonly notificationService: NotificationService,
	) {}

	/**
	 * Only for the caller's own OPEN brief and an ACTIVE creator. An existing invite is answered as it is, without
	 * counting against the daily limit.
	 */
	public async inviteCreator(userId: ObjectId, briefId: ObjectId, creatorId: ObjectId): Promise<Invite> {
		const brief = await this.briefModel.findOne({ _id: briefId, memberId: userId }).lean<Brief>().exec();
		if (!brief || brief.briefStatus === BriefStatus.DELETE) throw new NotFoundException(Message.NO_DATA_FOUND);
		if (brief.briefStatus !== BriefStatus.OPEN) throw new BadRequestException(Message.BRIEF_NOT_OPEN);

		const creator = await this.memberService.getAuthorData(creatorId);
		const isActiveCreator = creator?.memberType === MemberType.CREATOR && creator.memberStatus === MemberStatus.ACTIVE;
		if (!isActiveCreator) throw new BadRequestException(Message.INVALID_INVITE_TARGET);

		const existing = await this.inviteModel.findOne({ briefId, creatorId }).lean<Invite>().exec();
		if (existing) return existing;

		const sentToday = await this.inviteModel
			.countDocuments({ userId, createdAt: { $gt: new Date(Date.now() - DAY_MS) } })
			.exec();
		if (sentToday >= inviteDailyLimit) throw new BadRequestException(Message.INVITE_DAILY_LIMIT);

		let isNew = false;
		try {
			const written = await this.inviteModel
				.updateOne({ briefId, creatorId }, { $setOnInsert: { briefId, creatorId, userId } }, { upsert: true })
				.exec();
			isNew = written.upsertedCount === 1;
		} catch (err) {
			// two invites at the same moment: the other one inserted it, and the invite exists either way
			if (!isDuplicateKeyError(err)) {
				console.log('Error: Service.model', describeDbError(err));
				throw new BadRequestException(Message.CREATE_FAILED);
			}
		}

		const invite = await this.inviteModel.findOne({ briefId, creatorId }).lean<Invite>().exec();
		if (!invite) throw new InternalServerErrorException(Message.CREATE_FAILED);
		// D-50: only the request that inserted it notifies, so two at once send one notification
		if (isNew) await this.notificationService.notifyInvite(invite);
		return invite;
	}

	/** Brief.meInvited */
	public async isInvited(briefId: ObjectId, creatorId: ObjectId): Promise<boolean> {
		return !!(await this.inviteModel.exists({ briefId, creatorId }).exec());
	}

	/**
	 * The caller's invites (a creator), latest first, with the brief and its owner. Invites of a deleted brief drop out
	 * before $facet, so metaCounter matches (D-30); a CLOSED brief stays, the client shows its status.
	 */
	public async getMyInvites(creatorId: ObjectId, input: OrdinaryInquiry): Promise<Invites> {
		const { page, limit } = input;
		const result = await this.inviteModel
			.aggregate<Invites>([
				{ $match: { creatorId } },
				{ $sort: { createdAt: -1, _id: -1 } },
				{
					$lookup: {
						from: 'briefs',
						localField: 'briefId',
						foreignField: '_id',
						pipeline: [{ $match: { briefStatus: { $in: visibleBriefStatuses } } }, withoutEmbedding],
						as: 'briefData',
					},
				},
				{ $unwind: '$briefData' },
				{
					$facet: {
						list: [
							{ $skip: (page - 1) * limit },
							{ $limit: limit },
							{
								$lookup: {
									from: 'members',
									localField: 'userId',
									foreignField: '_id',
									pipeline: [excludeDeletedMember, excludeMemberSecrets],
									as: 'userData',
								},
							},
							unwindKeepingItem('$userData'),
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0];
	}

	/** removeBriefByAdmin: a hard-deleted brief takes its invites with it. Returns how many were removed. */
	public async removeInvitesOfBrief(briefId: ObjectId): Promise<number> {
		const result = await this.inviteModel.deleteMany({ briefId }).exec();
		return result.deletedCount;
	}
}
