import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from '../../types/common';
import { ProductStatus } from '../../enums/product.enum';
import { Member, TotalCounter } from '../member/member';
import { MeLiked } from '../like/like';

@ObjectType()
export class Product {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => ProductStatus)
	productStatus!: ProductStatus;

	@Field(() => String)
	productTitle!: string;

	@Field(() => Float)
	productPrice!: number;

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

	@Field(() => String, { nullable: true })
	productDesc?: string;

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
