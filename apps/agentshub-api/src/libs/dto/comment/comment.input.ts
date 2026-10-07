import { Field, InputType, Int } from '@nestjs/graphql';
import { IsIn, IsMongoId, IsNotEmpty, IsOptional, Length, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { ObjectId } from '../../types/common';
import { CommentGroup } from '../../enums/comment.enum';
import { Direction } from '../../enums/common.enum';
import { availableCommentSorts } from '../../config';

@InputType()
export class CommentInput {
	@IsNotEmpty()
	@Field(() => CommentGroup)
	commentGroup!: CommentGroup;

	@IsNotEmpty()
	@Length(1, 100)
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

	// the target type: a PRODUCT target follows the product's visibility (D-16); BRIEF is rejected until Step 7
	@IsNotEmpty()
	@Field(() => CommentGroup)
	commentGroup!: CommentGroup;
}

@InputType()
export class CommentsInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsNotEmpty()
	@Min(1)
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
