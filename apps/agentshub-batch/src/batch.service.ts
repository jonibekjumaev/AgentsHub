import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Product } from '../../agentshub-api/src/libs/dto/product/product';
import { Model } from 'mongoose';
import { Member } from '../../agentshub-api/src/libs/dto/member/member';
import { ProductStatus } from '../../agentshub-api/src/libs/enums/product.enum';
import { MemberStatus, MemberType } from '../../agentshub-api/src/libs/enums/member.enum';

@Injectable()
export class BatchService {
	constructor(
		@InjectModel('Product') private readonly productModel: Model<Product>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
	) {}
	/** Returns how many products and members were reset (for `npm run batch:run`; the crons ignore it). */
	public async batchRollback(): Promise<{ products: number; members: number }> {
		// every non-deleted product, PAUSED included: a resumed product must not keep its pre-pause rank (D-16)
		const products = await this.productModel
			.updateMany({ productStatus: { $ne: ProductStatus.DELETE } }, { productRank: 0 })
			.exec();

		// every creator whatever its status, so a blocked creator keeps no stale rank; ranking stays ACTIVE only
		const members = await this.memberModel.updateMany({ memberType: MemberType.CREATOR }, { memberRank: 0 }).exec();

		return { products: products.modifiedCount, members: members.modifiedCount };
	}

	/** Returns how many products were ranked. */
	public async batchProducts(): Promise<number> {
		const products: Product[] = await this.productModel
			.find({
				productStatus: ProductStatus.ACTIVE,
				productRank: 0,
			})
			.exec();

		const promisedList = products.map(async (ele: Product) => {
			const { _id, productLikes, productViews } = ele;
			const rank = productLikes * 2 + productViews * 1;
			return await this.productModel.findByIdAndUpdate(_id, { productRank: rank }).exec();
		});

		await Promise.all(promisedList);
		return products.length;
	}

	/** Returns how many creators were ranked. */
	public async batchCreators(): Promise<number> {
		const creators: Member[] = await this.memberModel
			.find({
				memberType: MemberType.CREATOR,
				memberStatus: MemberStatus.ACTIVE,
				memberRank: 0,
			})
			.exec();

		const promisedList = creators.map(async (ele: Member) => {
			// only engagement received from other members; the creator's own post counts are not a signal (D-22)
			const { _id, memberLikes, memberViews } = ele;
			const rank = memberLikes * 2 + memberViews * 1;
			return await this.memberModel.findByIdAndUpdate(_id, { memberRank: rank }).exec();
		});

		await Promise.all(promisedList);
		return creators.length;
	}

	getHello(): string {
		return 'Hello to AgentsHub BATCH server!';
	}
}
