import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsMongoId, IsNotEmpty, IsString, Length, ValidateIf } from 'class-validator';
import { CommentStatus } from '../../enums/comment.enum';
import type { ObjectId } from '../../types/common';
import { commentContentMaxLength } from '../../config';

@InputType()
export class CommentUpdate {
	@IsNotEmpty()
	@IsMongoId()
	@Field(() => String)
	_id!: ObjectId;

	@ValidateIf((o: CommentUpdate) => o.commentStatus !== undefined) // reject null: a comment always has a status
	@IsEnum(CommentStatus)
	@Field(() => CommentStatus, { nullable: true })
	commentStatus?: CommentStatus;

	@ValidateIf((o: CommentUpdate) => o.commentContent !== undefined) // reject null: the field is required
	@IsString()
	@Length(1, commentContentMaxLength) // D-35
	@Field(() => String, { nullable: true })
	commentContent?: string;
}
