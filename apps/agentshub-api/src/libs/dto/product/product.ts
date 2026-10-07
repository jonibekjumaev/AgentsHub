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
