import {
	BadRequestException,
	ConflictException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HydratedDocument, Model, PipelineStage, UpdateQuery } from 'mongoose';
import {
	CreatorProductsInquiry,
	AllProductsInquiry,
	ProductsInquiry,
	PeriodsRange,
	ProductFilters,
	ProductInput,
} from '../../libs/dto/product/product.input';
import { OrdinaryInquiry } from '../../libs/dto/common.input';
import { Products, Product } from '../../libs/dto/product/product';
import { Direction, Message } from '../../libs/enums/common.enum';
import { MemberService } from '../member/member.service';
import { ObjectId, StatisticModifier, T } from '../../libs/types/common';
import { ProductPricing, ProductStatus } from '../../libs/enums/product.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { ViewGroup } from '../../libs/enums/view.enum';
import { ViewService } from '../view/view.service';
import { ViewInput } from '../../libs/dto/view/view.input';
import { ProductUpdate } from '../../libs/dto/product/product.update';
import moment from 'moment';
import {
	escapeRegex,
	lookupAuthMemberLiked,
	lookupMember,
	paidProductPricings,
	shapeInToMongoObjectId,
} from '../../libs/config';
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

	public async getProduct(
		memberId: ObjectId | null,
		memberType: MemberType | null,
		productId: ObjectId,
	): Promise<Product> {
		const targetProduct = await this.productModel.findOne({ _id: productId }).lean().exec();
		// a product the caller may not see gets the same answer as a missing one (D-16)
		if (!targetProduct || !this.isProductVisible(targetProduct, memberId, memberType)) {
			throw new NotFoundException(Message.NO_DATA_FOUND);
		}

		if (memberId) {
			// own product views don't count (D-22); a PAUSED product records no view, not even for the owner (D-16)
			const isOwnProduct = memberId.equals(targetProduct.memberId);
			const isActive = targetProduct.productStatus === ProductStatus.ACTIVE;
			const viewInput: ViewInput = { memberId: memberId, viewRefId: productId, viewGroup: ViewGroup.PRODUCT };
			const newView = isOwnProduct || !isActive ? null : await this.viewService.recordView(viewInput);
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
		return await this.applyProductUpdate({ _id: input._id, memberId: memberId }, input);
	}

	public async getProducts(memberId: ObjectId, input: ProductsInquiry): Promise<Products> {
		const match: T = { productStatus: ProductStatus.ACTIVE };

		this.shapeMatchQuery(match, input.search);

		const result = await this.productModel
			.aggregate([
				{ $match: match },
				...this.shapeSortStages(input.sort, input.direction),
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

	/** The search filters shared by the three product lists (Step 6 part 13). Empty lists mean "no filter". */
	private shapeMatchQuery(
		match: T,
		search: ProductFilters & { memberId?: ObjectId; periodsRange?: PeriodsRange },
	): void {
		const { memberId, periodsRange, pricesRange, categoryList, pricingList, tagList, text } = search;

		if (memberId) match.memberId = shapeInToMongoObjectId(memberId);
		if (categoryList?.length) match.productCategory = { $in: categoryList };
		if (pricingList?.length) match.productPricing = { $in: pricingList };

		if (pricesRange) {
			if (pricesRange.start > pricesRange.end) throw new BadRequestException(Message.INVALID_PRICE_RANGE);
			// D-03: only ONE_TIME / SUBSCRIPTION products have a price; with a pricingList, only the overlap is matched
			const pricings = pricingList?.length
				? pricingList.filter((pricing) => paidProductPricings.includes(pricing))
				: paidProductPricings;
			match.productPricing = { $in: pricings };
			match.productPrice = { $gte: pricesRange.start, $lte: pricesRange.end };
		}

		if (tagList?.length) match.productTags = { $all: normalizeTags(tagList) };
		if (periodsRange) match.createdAt = { $gte: periodsRange.start, $lte: periodsRange.end };
		if (text) match.productTitle = { $regex: new RegExp(escapeRegex(text), 'i') };
	}

	/**
	 * The $sort stages of the product lists. Ties are broken by the newest _id, so skip/limit pages stay stable.
	 * Sorting by productPrice puts products without a price (FREE / CUSTOM, D-03) last in both directions.
	 */
	private shapeSortStages(sort: string = 'createdAt', direction: Direction = Direction.DESC): PipelineStage[] {
		if (sort === 'productPrice') {
			return [
				{ $addFields: { _hasPrice: { $cond: [{ $isNumber: '$productPrice' }, 1, 0] } } },
				{ $sort: { _hasPrice: -1, productPrice: direction, _id: -1 } },
				{ $unset: '_hasPrice' },
			];
		}
		return [{ $sort: { [sort]: direction, _id: -1 } }];
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

		const match: T = {
			memberId,
			productStatus: productStatus ?? { $ne: ProductStatus.DELETE },
		};
		this.shapeMatchQuery(match, input.search);

		const result = await this.productModel
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

		if (productStatus) match.productStatus = productStatus;
		this.shapeMatchQuery(match, input.search);

		const result = await this.productModel
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
		return result[0] as Products;
	}

	public async updateProductByAdmin(input: ProductUpdate): Promise<Product> {
		// admins may make the same status changes as the owner (D-29)
		return await this.applyProductUpdate({ _id: input._id }, input);
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

	/**
	 * D-16 visibility of one product: ACTIVE for everyone, PAUSED only for its owner and admins, DELETE for nobody
	 * (admins see deleted products only in getAllProductsByAdmin). Child records (e.g. comments) follow the same rule.
	 */
	public isProductVisible(
		product: Pick<Product, 'productStatus' | 'memberId'>,
		memberId: ObjectId | null,
		memberType: MemberType | null,
	): boolean {
		if (product.productStatus === ProductStatus.ACTIVE) return true;
		if (product.productStatus !== ProductStatus.PAUSED) return false;
		return memberType === MemberType.ADMIN || (!!memberId && memberId.equals(product.memberId));
	}

	/** D-03, the only place it is checked: ONE_TIME / SUBSCRIPTION need a price > 0, FREE / CUSTOM must have none. */
	private checkPricingRule(productPricing: ProductPricing, productPrice: number | null | undefined): void {
		const isPaid = paidProductPricings.includes(productPricing);
		const hasPrice = productPrice !== null && productPrice !== undefined;

		if (isPaid && !(hasPrice && productPrice > 0)) throw new BadRequestException(Message.PRICE_REQUIRED);
		if (!isPaid && hasPrice) throw new BadRequestException(Message.PRICE_NOT_ALLOWED);
	}

	/**
	 * The update shared by updateProduct (search has the owner's memberId) and updateProductByAdmin. A deleted product
	 * is not matched, so it answers like a missing one. The write is pinned to the status that was read and checked,
	 * so a concurrent change (e.g. a second DELETE) matches nothing: memberProducts is decremented once (D-16).
	 */
	private async applyProductUpdate(search: T, input: ProductUpdate): Promise<Product> {
		if (input.productTags) input.productTags = normalizeTags(input.productTags);

		const stored = await this.productModel
			.findOne({ ...search, productStatus: { $ne: ProductStatus.DELETE } })
			.select('productStatus productPricing productPrice')
			.lean()
			.exec();
		if (!stored) throw new NotFoundException(Message.UPDATE_FAILED);

		const isDeleting = this.checkStatusChange(stored.productStatus, input.productStatus);
		if (isDeleting) input.deletedAt = moment().toDate();
		const update = this.shapePricingUpdate(stored, input);

		let result: HydratedDocument<Product> | null;
		try {
			result = await this.productModel
				.findOneAndUpdate({ ...search, productStatus: stored.productStatus }, update, { new: true })
				.exec();
		} catch (err) {
			if (isDuplicateKeyError(err)) throw new ConflictException(Message.USED_PRODUCT_TITLE); // B15
			throw err;
		}
		if (!result) throw new NotFoundException(Message.UPDATE_FAILED); // the status changed since it was read

		// memberProducts counts ACTIVE + PAUSED: only a change to DELETE decrements it, pause/resume don't (D-16)
		if (isDeleting) {
			await this.memberService.memberStatsEditor({
				_id: result.memberId,
				targetKey: 'memberProducts',
				modifier: -1,
			});
		}
		return result;
	}

	/**
	 * D-16 / D-29 status changes: ACTIVE <-> PAUSED, ACTIVE | PAUSED -> DELETE; DELETE is final. The same status (or
	 * none) is no change. Returns whether the product is being deleted.
	 */
	private checkStatusChange(current: ProductStatus, next: ProductStatus | undefined): boolean {
		if (next === undefined || next === current) return false;

		const isAllowed =
			(current === ProductStatus.ACTIVE && next === ProductStatus.PAUSED) ||
			(current === ProductStatus.PAUSED && next === ProductStatus.ACTIVE) ||
			(current !== ProductStatus.DELETE && next === ProductStatus.DELETE);
		if (!isAllowed) throw new BadRequestException(Message.INVALID_PRODUCT_STATUS_CHANGE);
		return next === ProductStatus.DELETE;
	}

	/**
	 * Checks D-03 on the final pricing/price of an update (stored values merged with the input) and returns the update.
	 * A price left out is kept, except that switching to FREE / CUSTOM clears it; no price is stored as $unset, not null.
	 */
	private shapePricingUpdate(
		stored: Pick<Product, 'productPricing' | 'productPrice'>,
		input: ProductUpdate,
	): UpdateQuery<Product> {
		const finalPricing = input.productPricing ?? stored.productPricing;
		const isPaid = paidProductPricings.includes(finalPricing);
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
