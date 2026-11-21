import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsMongoId, IsNotEmpty, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { listPageMax } from '../../config';
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
	@IsInt()
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsInt()
	@IsNotEmpty()
	@Min(1)
	@Max(listPageMax)
	@Field(() => Int)
	limit!: number;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => FollowSearch)
	@Field(() => FollowSearch)
	search!: FollowSearch;
}
