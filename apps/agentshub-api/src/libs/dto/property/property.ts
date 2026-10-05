import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from '../../types/common';
import { PropertyStatus } from '../../enums/property.enum';
import { Member, TotalCounter } from '../member/member';
import { MeLiked } from '../like/like';

@ObjectType()
export class Property {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => String)
	propertyStatus!: PropertyStatus;

	@Field(() => String)
	propertyTitle!: string;

	@Field(() => Float)
	propertyPrice!: number;

	@Field(() => Int)
	propertyViews!: number;

	@Field(() => Int)
	propertyLikes!: number;

	@Field(() => Int)
	propertyComments!: number;

	@Field(() => Int)
	propertyRank!: number;

	@Field(() => [String])
	propertyImages!: string[];

	@Field(() => String, { nullable: true })
	propertyDesc?: string;

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
export class Properties {
	@Field(() => [Property])
	list!: Property[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter!: TotalCounter[];
}
