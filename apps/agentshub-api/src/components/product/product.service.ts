import {
	BadRequestException,
	ConflictException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HydratedDocument, Model, UpdateQuery } from 'mongoose';
import {
	CreatorProductsInquiry,
	AllProductsInquiry,
	ProductsInquiry,
	ProductInput,
} from '../../libs/dto/product/product.input';
import { OrdinaryInquiry } from '../../libs/dto/common.input';
import { Products, Product } from '../../libs/dto/product/product';
import { Direction, Message } from '../../libs/enums/common.enum';
import { MemberService } from '../member/member.service';
import { ObjectId, StatisticModifier, T } from '../../libs/types/common';
import { ProductPricing, ProductStatus } from '../../libs/enums/product.enum';
import { ViewGroup } from '../../libs/enums/view.enum';
import { ViewService } from '../view/view.service';
import { ViewInput } from '../../libs/dto/view/view.input';
import { ProductUpdate } from '../../libs/dto/product/product.update';
import moment from 'moment';
import { escapeRegex, lookupAuthMemberLiked, lookupMember, shapeInToMongoObjectId } from '../../libs/config';
import { LikeService } from '../like/like.service';
import { LikeInput } from '../../libs/dto/like/like.input';
import { LikeGroup } from '../../libs/enums/like.enum';
import { describeDbError, isDuplicateKeyError, normalizeTags } from '../../libs/utils';

@Injectable()
export class ProductService {
	constructor(
		@InjectModel('Product') private readonly productModel: Model<Product>,
		private memberService: MemberService,
		private viewService: ViewService,
		private likeService: LikeService,
	) {}

	public async createProduct(input: ProductInput): Promise<Product> {
		if (input.productTags) input.productTags = normalizeTags(input.productTags);
		this.checkPricingRule(input.productPricing, input.productPrice);
		if (input.productPrice === null) delete input.productPrice; // FREE / CUSTOM: no price is stored (D-03)
		try {
			const result = await this.productModel.create(input);
			//Increase memberProducts+
			await this.memberService.memberStatsEditor({
				_id: result.memberId,
				targetKey: 'memberProducts',
				modifier: 1,
			});
			return result;
		} catch (err) {
			console.log('Error: Service.model', describeDbError(err));
			if (isDuplicateKeyError(err)) throw new ConflictException(Message.USED_PRODUCT_TITLE);
			throw new BadRequestException(Message.CREATE_FAILED);
		}
	}

	public async getProduct(memberId: ObjectId, productId: ObjectId): Promise<Product> {
		const search = {
			_id: productId,
			productStatus: ProductStatus.ACTIVE,
		};

		const targetProduct = await this.productModel.findOne(search).lean().exec();
		if (!targetProduct) throw new NotFoundException(Message.NO_DATA_FOUND);

		if (memberId) {
			// own product views don't count (D-22)
			const isOwnProduct = memberId.equals(targetProduct.memberId);
			const viewInput: ViewInput = { memberId: memberId, viewRefId: productId, viewGroup: ViewGroup.PRODUCT };
			const newView = isOwnProduct ? null : await this.viewService.recordView(viewInput);
			if (newView) {
				await this.productStatsEditor({ _id: productId, targetKey: 'productViews', modifier: 1 });
				targetProduct.productViews++;
			}

			//meLiked
			const likeInput: LikeInput = { memberId: memberId, likeRefId: productId, likeGroup: LikeGroup.PRODUCT };
			targetProduct.meLiked = await this.likeService.checkLikeExistence(likeInput);
		}

		targetProduct.memberData = await this.memberService.getMember(null, targetProduct.memberId);
		return targetProduct;
	}

	public async updateProduct(memberId: ObjectId, input: ProductUpdate): Promise<Product> {
		const { productStatus } = input;
		if (input.productTags) input.productTags = normalizeTags(input.productTags);

		const search = {
			_id: input._id,
			memberId: memberId,
			productStatus: ProductStatus.ACTIVE,
		};

		if (productStatus === ProductStatus.DELETE) input.deletedAt = moment().toDate();
		const update = await this.shapePricingUpdate(search, input);

		let result: HydratedDocument<Product> | null;
		try {
			result = await this.productModel.findOneAndUpdate(search, update, { new: true }).exec();
		} catch (err) {
			if (isDuplicateKeyError(err)) throw new ConflictException(Message.USED_PRODUCT_TITLE); // B15
			throw err;
		}
		if (!result) throw new NotFoundException(Message.UPDATE_FAILED);

		if (input.deletedAt) {
			await this.memberService.memberStatsEditor({
				_id: memberId,
				targetKey: 'memberProducts',
				modifier: -1,
			});
		}
		return result;
	}

	public async getProducts(memberId: ObjectId, input: ProductsInquiry): Promise<Products> {
		const match = { productStatus: ProductStatus.ACTIVE };
		const sort = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		this.shapeMatchQuery(match, input);

		const result = await this.productModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							//meliked
							lookupAuthMemberLiked(memberId),

							lookupMember,
							{ $unwind: '$memberData' },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0] as Products;
	}

	private shapeMatchQuery(match: T, input: ProductsInquiry): void {
		const { memberId, periodsRange, pricesRange, text } = input.search;

		if (memberId) match.memberId = shapeInToMongoObjectId(memberId);

		if (pricesRange) match.productPrice = { $gte: pricesRange.start, $lte: pricesRange.end };
		if (periodsRange) match.createdAt = { $gte: periodsRange.start, $lte: periodsRange.end };

		if (text) match.productTitle = { $regex: new RegExp(escapeRegex(text), 'i') };
	}

	public async getFavorities(memberId: ObjectId, input: OrdinaryInquiry): Promise<Products> {
		return await this.likeService.getFavoriteProducts(memberId, input);
	}

	public async getVisited(memberId: ObjectId, input: OrdinaryInquiry): Promise<Products> {
		return await this.viewService.getVisitedProducts(memberId, input);
	}

	public async getCreatorProducts(memberId: ObjectId, input: CreatorProductsInquiry): Promise<Products> {
		const { productStatus } = input.search;
		if (productStatus === ProductStatus.DELETE) throw new BadRequestException(Message.NO_DATA_FOUND);

		const match = {
			memberId,
			productStatus: productStatus ?? { $ne: ProductStatus.DELETE },
		};
		const sort = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		const result = await this.productModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
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
		return result[0] as Products;
	}

	public async likeTargetProduct(memberId: ObjectId, likeRefId: ObjectId): Promise<Product> {
		const target = await this.productModel.findOne({ _id: likeRefId, productStatus: ProductStatus.ACTIVE }).exec();
		if (!target) throw new NotFoundException(Message.NO_DATA_FOUND);
		if (memberId.equals(target.memberId)) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST); // D-22

		const input: LikeInput = {
			memberId: memberId,
			likeRefId: likeRefId,
			likeGroup: LikeGroup.PRODUCT,
		};

		//LIKE TOGGLE
		const modifier: number = await this.likeService.toggleLike(input);
		const result = await this.productStatsEditor({ _id: likeRefId, targetKey: 'productLikes', modifier: modifier });

		if (!result) throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);
		return result;
	}

	public async getAllProductsByAdmin(input: AllProductsInquiry): Promise<Products> {
		const { productStatus } = input.search;
		const match: T = {};
		const sort = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (productStatus) match.productStatus = productStatus;

		const result = await this.productModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
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
		return result[0] as Products;
	}

	public async updateProductByAdmin(input: ProductUpdate): Promise<Product> {
		const { productStatus } = input;
		if (input.productTags) input.productTags = normalizeTags(input.productTags);
		const search = {
			_id: input._id,
			productStatus: ProductStatus.ACTIVE,
		};

		if (productStatus === ProductStatus.DELETE) input.deletedAt = moment().toDate();
		const update = await this.shapePricingUpdate(search, input);

		let result: HydratedDocument<Product> | null;
		try {
			result = await this.productModel.findOneAndUpdate(search, update, { new: true }).exec();
		} catch (err) {
			if (isDuplicateKeyError(err)) throw new ConflictException(Message.USED_PRODUCT_TITLE); // B15
			throw err;
		}
		if (!result) throw new NotFoundException(Message.UPDATE_FAILED);

		if (input.deletedAt) {
			await this.memberService.memberStatsEditor({
				_id: result?.memberId,
				targetKey: 'memberProducts',
				modifier: -1,
			});
		}

		return result;
	}

	public async removeProductByAdmin(productId: ObjectId): Promise<Product> {
		const search = {
			_id: productId,
			productStatus: ProductStatus.DELETE,
		};

		const result = await this.productModel.findOneAndDelete(search).exec();
		if (!result) throw new NotFoundException(Message.REMOVE_FAILED);
		return result;
	}

	public async productStatsEditor(input: StatisticModifier): Promise<Product> {
		const { _id, targetKey, modifier } = input;
		const result = await this.productModel
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

	/** D-03, the only place it is checked: ONE_TIME / SUBSCRIPTION need a price > 0, FREE / CUSTOM must have none. */
	private checkPricingRule(productPricing: ProductPricing, productPrice: number | null | undefined): void {
		const isPaid = productPricing === ProductPricing.ONE_TIME || productPricing === ProductPricing.SUBSCRIPTION;
		const hasPrice = productPrice !== null && productPrice !== undefined;

		if (isPaid && !(hasPrice && productPrice > 0)) throw new BadRequestException(Message.PRICE_REQUIRED);
		if (!isPaid && hasPrice) throw new BadRequestException(Message.PRICE_NOT_ALLOWED);
	}

	/**
	 * Checks D-03 on the final pricing/price of an update (stored values merged with the input) and returns the update.
	 * A price left out is kept, except that switching to FREE / CUSTOM clears it; no price is stored as $unset, not null.
	 */
	private async shapePricingUpdate(search: T, input: ProductUpdate): Promise<UpdateQuery<Product>> {
		const stored = await this.productModel.findOne(search).select('productPricing productPrice').lean().exec();
		if (!stored) throw new NotFoundException(Message.UPDATE_FAILED);

		const finalPricing = input.productPricing ?? stored.productPricing;
		const isPaid = finalPricing === ProductPricing.ONE_TIME || finalPricing === ProductPricing.SUBSCRIPTION;
		let finalPrice: number | null | undefined;
		if (input.productPrice !== undefined) finalPrice = input.productPrice;
		else finalPrice = isPaid ? stored.productPrice : null;

		this.checkPricingRule(finalPricing, finalPrice);

		const update: UpdateQuery<Product> = { ...input };
		if (finalPrice === null || finalPrice === undefined) {
			delete update.productPrice;
			update.$unset = { productPrice: 1 };
		}
		return update;
	}
}
