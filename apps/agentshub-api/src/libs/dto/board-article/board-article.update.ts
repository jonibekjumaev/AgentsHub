import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { BoardArticleStatus } from '../../enums/board-article.enum';
import type { ObjectId } from '../../types/common';

@InputType()
export class BoardArticleUpdate {
	@IsNotEmpty()
	@Field(() => String)
	_id!: ObjectId;

	@ValidateIf((o) => o.articleStatus !== undefined) // reject null: an article always has a status
	@IsEnum(BoardArticleStatus)
	@Field(() => BoardArticleStatus, { nullable: true })
	articleStatus?: BoardArticleStatus;

	@ValidateIf((o) => o.articleTitle !== undefined) // reject null: the field is required
	@IsString()
	@Length(3, 50)
	@Field(() => String, { nullable: true })
	articleTitle?: string;

	@ValidateIf((o) => o.articleContent !== undefined) // reject null: the field is required
	@IsString()
	@Length(3, 250)
	@Field(() => String, { nullable: true })
	articleContent?: string;

	// null removes the image
	@IsOptional()
	@Field(() => String, { nullable: true })
	articleImage?: string;
}
