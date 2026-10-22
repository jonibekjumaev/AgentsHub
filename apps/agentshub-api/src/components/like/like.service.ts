import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Like, MeLiked } from '../../libs/dto/like/like';
import { LikeInput } from '../../libs/dto/like/like.input';
import { ObjectId, T } from '../../libs/types/common';
import { Message } from '../../libs/enums/common.enum';
import { OrdinaryInquiry } from '../../libs/dto/common.input';
import { Product, Products } from '../../libs/dto/product/product';
import { TotalCounter } from '../../libs/dto/member/member';
import { LikeGroup } from '../../libs/enums/like.enum';
import { ProductStatus } from '../../libs/enums/product.enum';
import { lookupFavorite, unwindKeepingItem } from '../../libs/config';
import { describeDbError } from '../../libs/utils';

/**
 * The liked target as the like mutations return it: a plain object with `meLiked` filled for the caller, from the
 * toggle's own result (+1 liked, -1 unliked), so the client needs no extra read (Step 13a item 4).
 */
export const withMeLiked = <D extends object>(
	target: D,
	input: LikeInput,
	modifier: number,
): D & { meLiked: MeLiked[] } => {
	const document = target as { toObject?: () => D };
	const plain: D = typeof document.toObject === 'function' ? document.toObject() : target;
	const meLiked = modifier > 0 ? [{ memberId: input.memberId, likeRefId: input.likeRefId, myFavorite: true }] : [];
	return { ...plain, meLiked };
};

@Injectable()
export class LikeService {
	constructor(@InjectModel('Like') private readonly likeModel: Model<Like>) {}

	public async toggleLike(input: LikeInput): Promise<number> {
		const search: T = { memberId: input.memberId, likeRefId: input.likeRefId };
		const exist = await this.likeModel.findOne(search).exec();
		let modifier = 1;

		if (exist) {
			await this.likeModel.findOneAndDelete(search).exec();
			modifier = -1;
		} else {
			try {
				await this.likeModel.create(input);
			} catch (err) {
				console.log('Error: Service.model', describeDbError(err));
				throw new BadRequestException(Message.CREATE_FAILED);
			}
		}

		return modifier;
	}

	public async checkLikeExistence(input: LikeInput): Promise<MeLiked[]> {
		const { memberId, likeRefId } = input;
		const result = await this.likeModel.findOne({ memberId: memberId, likeRefId: likeRefId });

		return result ? [{ memberId: memberId, likeRefId: likeRefId, myFavorite: true }] : [];
	}

	public async getFavoriteProducts(memberId: ObjectId, input: OrdinaryInquiry): Promise<Products> {
		const { page, limit } = input;
		const match = { likeGroup: LikeGroup.PRODUCT, memberId: memberId };

		const data = await this.likeModel
			.aggregate<{ list: { favoriteProduct: Product }[]; metaCounter: TotalCounter[] }>([
				{ $match: match },
				{ $sort: { updatedAt: -1 } },
				{
					$lookup: {
						from: 'products',
						localField: 'likeRefId',
						foreignField: '_id',
						as: 'favoriteProduct',
					},
				},
				{ $unwind: '$favoriteProduct' },
				{ $match: { 'favoriteProduct.productStatus': ProductStatus.ACTIVE } }, // D-16
				{
					$facet: {
						list: [
							{ $skip: (page - 1) * limit },
							{ $limit: limit },
							lookupFavorite,
							unwindKeepingItem('$favoriteProduct.memberData'),
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		const result: Products = { list: [], metaCounter: data[0].metaCounter };

		result.list = data[0].list.map((ele) => ele.favoriteProduct);

		return result;
	}
}
