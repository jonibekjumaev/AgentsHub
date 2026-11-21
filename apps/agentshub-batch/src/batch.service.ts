import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Product } from '../../agentshub-api/src/libs/dto/product/product';
import { Model } from 'mongoose';
import { Member } from '../../agentshub-api/src/libs/dto/member/member';
import { ProductStatus } from '../../agentshub-api/src/libs/enums/product.enum';
import { MemberStatus, MemberType } from '../../agentshub-api/src/libs/enums/member.enum';
import { Offer } from '../../agentshub-api/src/libs/dto/offer/offer';
import { Brief } from '../../agentshub-api/src/libs/dto/brief/brief';
import { OfferStatus } from '../../agentshub-api/src/libs/enums/offer.enum';

@Injectable()
export class BatchService {
	constructor(
		@InjectModel('Product') private readonly productModel: Model<Product>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		@InjectModel('Offer') private readonly offerModel: Model<Offer>,
		@InjectModel('Brief') private readonly briefModel: Model<Brief>,
	) {}
	/** Returns how many products and members were reset (for `npm run batch:run`; the crons ignore it). */
	public async batchRollback(): Promise<{ products: number; members: number }> {
		// every non-deleted product, PAUSED included: a resumed product must not keep its pre-pause rank (D-16)
		// positions go too: a product that is no longer ranked tonight must not keep yesterday's place (Step 13a item 5)
		const products = await this.productModel
			.updateMany(
				{ productStatus: { $ne: ProductStatus.DELETE } },
				{ $set: { productRank: 0 }, $unset: { productRankPosition: '' } },
			)
			.exec();

		// every creator whatever its status, so a blocked creator keeps no stale rank; ranking stays ACTIVE only
		const members = await this.memberModel
			.updateMany({ memberType: MemberType.CREATOR }, { $set: { memberRank: 0 }, $unset: { memberRankPosition: '' } })
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
		await this.writePositions(this.productModel, { productStatus: ProductStatus.ACTIVE }, 'productRank');
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
		await this.writePositions(
			this.memberModel,
			{ memberType: MemberType.CREATOR, memberStatus: MemberStatus.ACTIVE },
			'memberRank',
		);
		return creators.length;
	}

	/**
	 * D-48: stores EXPIRED on PENDING offers past their expiry and lowers their brief's briefOffers. Reads already treat
	 * them as expired, so this only makes the stored status and the counter match.
	 *
	 * One conditional write per offer, pinned to the expiry that was read: an offer re-sent or edited since (a new
	 * expiresAt) or accepted in between matches nothing and keeps its counter. Each brief is decremented exactly once per
	 * offer that really changed. Returns how many offers expired.
	 */
	public async expireOffers(now: Date = new Date()): Promise<number> {
		const due = await this.offerModel
			.find({ offerStatus: OfferStatus.PENDING, expiresAt: { $lte: now } })
			.select('_id briefId expiresAt')
			.lean<Pick<Offer, '_id' | 'briefId' | 'expiresAt'>[]>()
			.exec();

		let expired = 0;
		for (const offer of due ?? []) {
			const result = await this.offerModel
				.updateOne(
					{ _id: offer._id, offerStatus: OfferStatus.PENDING, expiresAt: offer.expiresAt },
					{ $set: { offerStatus: OfferStatus.EXPIRED, closedAt: now }, $unset: { expiresAt: 1 } },
				)
				.exec();
			if (result.modifiedCount !== 1) continue;

			await this.briefModel.updateOne({ _id: offer.briefId }, { $inc: { briefOffers: -1 } }).exec();
			expired++;
		}
		return expired;
	}

	/**
	 * Step 13a item 5: `<rank>Position` = 1, 2, 3… in the order the lists show (rank DESC, then newest _id first),
	 * for ranked documents only (rank > 0). Everything else keeps no position (null), see batchRollback.
	 */
	private async writePositions(
		model: Model<Product> | Model<Member>,
		filter: Record<string, unknown>,
		rankKey: 'productRank' | 'memberRank',
	): Promise<void> {
		// both models only need _id here; the cast keeps one code path for products and creators
		const positioned = model as unknown as Model<{ _id: unknown }>;
		const ranked = ((await positioned
			.find({ ...filter, [rankKey]: { $gt: 0 } })
			.sort({ [rankKey]: -1, _id: -1 })
			.select('_id')
			.lean()
			.exec()) ?? []) as { _id: unknown }[];

		const positionKey = `${rankKey}Position`;
		await Promise.all(
			ranked.map(({ _id }, index) => positioned.updateOne({ _id }, { $set: { [positionKey]: index + 1 } }).exec()),
		);
	}

	getHello(): string {
		return 'Hello to AgentsHub BATCH server!';
	}
}
