import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Save } from '../../libs/dto/save/save';
import { Brief, Briefs } from '../../libs/dto/brief/brief';
import { TotalCounter } from '../../libs/dto/member/member';
import { OrdinaryInquiry } from '../../libs/dto/common.input';
import { visibleBriefStatuses } from '../../libs/enums/brief.enum';
import { Message } from '../../libs/enums/common.enum';
import { lookupSavedBriefAuthor, unwindKeepingItem, withoutEmbedding } from '../../libs/config';
import { describeDbError, isDuplicateKeyError } from '../../libs/utils';
import type { ObjectId } from '../../libs/types/common';

/**
 * D-47: the `saves` collection. It only stores and reads saves; the rules about which brief may be saved (visible,
 * not your own) and by whom (USER, CREATOR) live in BriefService and BriefResolver, next to the other brief rules.
 */
@Injectable()
export class SaveService {
	constructor(@InjectModel('Save') private readonly saveModel: Model<Save>) {}

	/**
	 * Idempotent: an upsert on the unique `{ memberId, briefId }` pair, so saving a saved brief changes nothing (only
	 * `updatedAt`; `createdAt`, the list order, stays the first save). Two saves at the same moment can still race to
	 * the insert; the loser gets E11000, and the save exists either way.
	 */
	public async saveBrief(memberId: ObjectId, briefId: ObjectId): Promise<void> {
		try {
			await this.saveModel
				.updateOne({ memberId, briefId }, { $setOnInsert: { memberId, briefId } }, { upsert: true })
				.exec();
		} catch (err) {
			if (isDuplicateKeyError(err)) return;
			console.log('Error: Service.model', describeDbError(err));
			throw new BadRequestException(Message.CREATE_FAILED);
		}
	}

	/** Idempotent: unsaving a brief that isn't saved changes nothing. */
	public async unsaveBrief(memberId: ObjectId, briefId: ObjectId): Promise<void> {
		await this.saveModel.deleteOne({ memberId, briefId }).exec();
	}

	public async isBriefSaved(memberId: ObjectId, briefId: ObjectId): Promise<boolean> {
		return !!(await this.saveModel.exists({ memberId, briefId }).exec());
	}

	/** removeBriefByAdmin: a hard-deleted brief takes its saves with it. Returns how many were removed. */
	public async removeSavesOfBrief(briefId: ObjectId): Promise<number> {
		const result = await this.saveModel.deleteMany({ briefId }).exec();
		return result.deletedCount;
	}

	/**
	 * The caller's saved briefs, latest saved first. Only briefs anyone can read (OPEN, CLOSED; D-30): a deleted brief
	 * drops out before $facet, so metaCounter matches the list (as getFavoriteProducts does for paused products, D-16).
	 */
	public async getSavedBriefs(memberId: ObjectId, input: OrdinaryInquiry): Promise<Briefs> {
		const { page, limit } = input;

		const data = await this.saveModel
			.aggregate<{ list: { savedBrief: Brief }[]; metaCounter: TotalCounter[] }>([
				{ $match: { memberId } },
				{ $sort: { createdAt: -1, _id: -1 } },
				{
					$lookup: {
						from: 'briefs',
						localField: 'briefId',
						foreignField: '_id',
						pipeline: [withoutEmbedding], // D-52
						as: 'savedBrief',
					},
				},
				{ $unwind: '$savedBrief' }, // a save whose brief was removed has nothing to join: dropped
				{ $match: { 'savedBrief.briefStatus': { $in: visibleBriefStatuses } } },
				{
					$facet: {
						list: [
							{ $skip: (page - 1) * limit },
							{ $limit: limit },
							lookupSavedBriefAuthor,
							unwindKeepingItem('$savedBrief.memberData'),
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!data.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return {
			list: data[0].list.map((item) => ({ ...item.savedBrief, meSaved: true })),
			metaCounter: data[0].metaCounter,
		};
	}
}
