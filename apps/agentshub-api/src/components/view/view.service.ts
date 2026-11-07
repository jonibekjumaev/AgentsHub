import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProfileVisit, ProfileVisitors, View } from '../../libs/dto/view/view';
import { ViewInput } from '../../libs/dto/view/view.input';
import { ObjectId, T } from '../../libs/types/common';
import { OrdinaryInquiry } from '../../libs/dto/common.input';
import { ViewGroup } from '../../libs/enums/view.enum';
import { ProductStatus } from '../../libs/enums/product.enum';
import { Product, Products } from '../../libs/dto/product/product';
import { TotalCounter } from '../../libs/dto/member/member';
import { MemberType } from '../../libs/enums/member.enum';
import {
	excludeDeletedMember,
	excludeMemberSecrets,
	lookupVisit,
	profileVisitorsWindowDays,
	unwindKeepingItem,
} from '../../libs/config';
import { isDuplicateKeyError } from '../../libs/utils';
import { Model } from 'mongoose';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ViewService {
	constructor(@InjectModel('View') private readonly viewModel: Model<View>) {}

	/**
	 * Records that `memberId` opened `viewRefId`. Resolves true only for the first view, so the caller increments its
	 * counter once per member (D-22 rules stay with the caller: own items, PAUSED products, closed briefs).
	 *
	 * - One atomic upsert instead of findOne + create (B24): a repeat view refreshes `updatedAt` (timestamps), so
	 *   "recently visited" and "who viewed your profile" follow the latest visit; two parallel first views can no
	 *   longer both try to insert and fail on the unique index (memberId + viewRefId).
	 * - An ADMIN's views are never recorded (D-42): moderation must not inflate counters or show up as a visitor.
	 */
	public async recordView(input: ViewInput, viewerType: MemberType | null): Promise<boolean> {
		if (viewerType === MemberType.ADMIN) return false;

		try {
			const result = await this.viewModel
				.updateOne(
					{ memberId: input.memberId, viewRefId: input.viewRefId },
					{ $setOnInsert: { viewGroup: input.viewGroup } },
					{ upsert: true },
				)
				.exec();
			return result.upsertedCount === 1;
		} catch (err) {
			// a parallel request inserted the same view first: this one is a repeat view
			if (isDuplicateKeyError(err)) return false;
			throw err;
		}
	}

	/**
	 * D-42 "Who viewed your profile": members who opened `memberId`'s profile in the last `profileVisitorsWindowDays`,
	 * latest visit first. Deleted members are left out (D-38) and so are admins (views recorded before D-42).
	 * Members with memberBrowsePrivately are only counted in `privateCount`; the check uses their current setting.
	 */
	public async getProfileVisitors(
		memberId: ObjectId,
		input: OrdinaryInquiry,
		now = new Date(),
	): Promise<ProfileVisitors> {
		const { page, limit } = input;
		const since = new Date(now.getTime() - profileVisitorsWindowDays * DAY_MS);
		const isPrivate = { 'visitor.memberBrowsePrivately': true };
		const isPublic = { 'visitor.memberBrowsePrivately': { $ne: true } };

		const data = await this.viewModel
			.aggregate<{ list: ProfileVisit[]; metaCounter: TotalCounter[]; privateCounter: TotalCounter[] }>([
				{ $match: { viewRefId: memberId, viewGroup: ViewGroup.MEMBER, updatedAt: { $gte: since } } },
				{ $sort: { updatedAt: -1, _id: -1 } },
				{
					$lookup: {
						from: 'members',
						localField: 'memberId',
						foreignField: '_id',
						pipeline: [excludeDeletedMember, excludeMemberSecrets],
						as: 'visitor',
					},
				},
				{ $unwind: '$visitor' }, // a deleted visitor is dropped, not shown as "Deleted member"
				{ $match: { 'visitor.memberType': { $ne: MemberType.ADMIN } } },
				{
					$facet: {
						list: [
							{ $match: isPublic },
							{ $skip: (page - 1) * limit },
							{ $limit: limit },
							{ $project: { _id: 1, visitor: 1, visitedAt: '$updatedAt' } },
						],
						metaCounter: [{ $match: isPublic }, { $count: 'total' }],
						privateCounter: [{ $match: isPrivate }, { $count: 'total' }],
					},
				},
			])
			.exec();

		const { list, metaCounter, privateCounter } = data[0];
		return { list, metaCounter, privateCount: privateCounter[0]?.total ?? 0 };
	}

	public async getVisitedProducts(memberId: ObjectId, input: OrdinaryInquiry): Promise<Products> {
		const { page, limit } = input;
		const match: T = { viewGroup: ViewGroup.PRODUCT, memberId: memberId };

		const data = await this.viewModel
			.aggregate<{ list: { visitedProduct: Product }[]; metaCounter: TotalCounter[] }>([
				{ $match: match },
				{ $sort: { updatedAt: -1 } },
				{
					$lookup: {
						from: 'products',
						localField: 'viewRefId',
						foreignField: '_id',
						as: 'visitedProduct',
					},
				},
				{ $unwind: '$visitedProduct' },
				{ $match: { 'visitedProduct.productStatus': ProductStatus.ACTIVE } }, // D-16
				{
					$facet: {
						list: [
							{ $skip: (page - 1) * limit },
							{ $limit: limit },
							lookupVisit,
							unwindKeepingItem('$visitedProduct.memberData'),
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		const result: Products = { list: [], metaCounter: data[0].metaCounter };
		result.list = data[0].list.map((ele) => ele.visitedProduct);

		return result;
	}
}
