import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from '../../types/common';
import { ProductPricing, ProductStatus } from '../../enums/product.enum';
import { AgentCategory } from '../../enums/agent-category.enum';
import { Member, TotalCounter } from '../member/member';
import { MeLiked } from '../like/like';

@ObjectType()
export class Product {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => AgentCategory)
	productCategory!: AgentCategory;

	@Field(() => ProductStatus)
	productStatus!: ProductStatus;

	@Field(() => ProductPricing)
	productPricing!: ProductPricing;

	@Field(() => String)
	productTitle!: string;

	// null for FREE and CUSTOM pricing (D-03)
	@Field(() => Float, { nullable: true })
	productPrice?: number;

	@Field(() => String, { nullable: true })
	productDemoUrl?: string;

	@Field(() => [String], { nullable: true })
	productTags?: string[];

	@Field(() => Int)
	productViews!: number;

	@Field(() => Int)
	productLikes!: number;

	@Field(() => Int)
	productComments!: number;

	@Field(() => Int)
	productRank!: number;

	/** The place in the nightly ranking (1 = top); null when not ranked (Step 13a item 5) */
	@Field(() => Int, { nullable: true })
	productRankPosition?: number;

	@Field(() => [String])
	productImages!: string[];

	@Field(() => String)
	productDesc!: string;

	@Field(() => String)
	memberId!: ObjectId;

	@Field(() => Date, { nullable: true })
	deletedAt?: Date;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;

	/** from aggregation */

	@Field(() => [MeLiked], { nullable: true })
	meLiked?: MeLiked[];

	@Field(() => Member, { nullable: true })
	memberData?: Member;
}

@ObjectType()
export class Products {
	@Field(() => [Product])
	list!: Product[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter!: TotalCounter[];
}

/** How many ACTIVE products one category option would show (D-43). */
@ObjectType()
export class CategoryFacet {
	@Field(() => AgentCategory)
	value!: AgentCategory;

	@Field(() => Int)
	count!: number;
}

/** How many ACTIVE products one pricing option would show (D-43). */
@ObjectType()
export class PricingFacet {
	@Field(() => ProductPricing)
	value!: ProductPricing;

	@Field(() => Int)
	count!: number;
}

/**
 * Live counts for the /agents filter options (D-43). Every category and every pricing is listed, in enum
 * order, with 0 when nothing matches. Each group is counted with all the other filters applied, but not its
 * own: the category counts ignore categoryList, the pricing counts ignore pricingList.
 */
@ObjectType()
export class ProductFacets {
	@Field(() => [CategoryFacet])
	categories!: CategoryFacet[];

	@Field(() => [PricingFacet])
	pricing!: PricingFacet[];
}
