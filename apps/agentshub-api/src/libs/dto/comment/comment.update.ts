import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsString, Length, ValidateIf } from 'class-validator';
import { CommentStatus } from '../../enums/comment.enum';
import type { ObjectId } from '../../types/common';

@InputType()
export class CommentUpdate {
	@IsNotEmpty()
	@Field(() => String)
	_id!: ObjectId;

	@ValidateIf((o) => o.commentStatus !== undefined) // reject null: a comment always has a status
	@IsEnum(CommentStatus)
	@Field(() => CommentStatus, { nullable: true })
	commentStatus?: CommentStatus;

	@ValidateIf((o) => o.commentContent !== undefined) // reject null: the field is required
	@IsString()
	@Length(1, 100)
	@Field(() => String, { nullable: true })
	commentContent?: string;
}
