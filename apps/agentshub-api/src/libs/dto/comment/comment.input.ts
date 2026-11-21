import { Field, InputType, Int } from '@nestjs/graphql';
import {
	IsEnum,
	IsIn,
	IsInt,
	IsMongoId,
	IsNotEmpty,
	IsOptional,
	Length,
	Max,
	Min,
	ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { ObjectId } from '../../types/common';
import { CommentGroup } from '../../enums/comment.enum';
import { Direction } from '../../enums/common.enum';
import { availableCommentSorts, commentContentMaxLength, listPageMax } from '../../config';

@InputType()
export class CommentInput {
	@IsNotEmpty()
	@IsEnum(CommentGroup)
	@Field(() => CommentGroup)
	commentGroup!: CommentGroup;

	@IsNotEmpty()
	@Length(1, commentContentMaxLength) // D-35
	@Field(() => String)
	commentContent!: string;

	@IsNotEmpty()
	@Field(() => String)
	commentRefId!: ObjectId;

	memberId?: ObjectId;
}

@InputType()
class CISearch {
	@IsNotEmpty()
	@IsMongoId()
	@Field(() => String)
	commentRefId!: ObjectId;

	// the target type: comments follow the target's visibility (PRODUCT: D-16, BRIEF: D-30)
	@IsNotEmpty()
	@IsEnum(CommentGroup)
	@Field(() => CommentGroup)
	commentGroup!: CommentGroup;
}

@InputType()
export class CommentsInquiry {
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

	@IsOptional()
	@IsIn(availableCommentSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => CISearch)
	@Field(() => CISearch)
	search!: CISearch;
}
