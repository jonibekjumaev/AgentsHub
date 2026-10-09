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
		const products = await this.productModel
			.updateMany(
				{
					productStatus: ProductStatus.ACTIVE,
				},
				{ productRank: 0 },
			)
			.exec();

		const members = await this.memberModel
			.updateMany(
				{
					memberStatus: MemberStatus.ACTIVE,
					memberType: MemberType.CREATOR,
				},
				{
					memberRank: 0,
				},
			)
			.exec();

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
	public async batchAgents(): Promise<number> {
		const agents: Member[] = await this.memberModel
			.find({
				memberType: MemberType.CREATOR,
				memberStatus: MemberStatus.ACTIVE,
				memberRank: 0,
			})
			.exec();

		const promisedList = agents.map(async (ele: Member) => {
			const { _id, memberProducts, memberLikes, memberArticles, memberViews } = ele;
			const rank = memberProducts * 5 + memberArticles * 3 + memberLikes * 2 + memberViews * 1;
			return await this.memberModel.findByIdAndUpdate(_id, { memberRank: rank }).exec();
		});

		await Promise.all(promisedList);
		return agents.length;
	}

	getHello(): string {
		return 'Hello to AgentsHub BATCH server!';
	}
}
