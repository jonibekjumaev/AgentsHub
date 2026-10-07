import { Field, InputType, Int } from '@nestjs/graphql';
import { IsMongoId, IsNotEmpty, IsOptional, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { ObjectId } from '../../types/common';
@InputType()
class FollowSearch {
	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	followingId?: ObjectId;

	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	followerId?: ObjectId;
}

@InputType()
export class FollowInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit!: number;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => FollowSearch)
	@Field(() => FollowSearch)
	search!: FollowSearch;
}
