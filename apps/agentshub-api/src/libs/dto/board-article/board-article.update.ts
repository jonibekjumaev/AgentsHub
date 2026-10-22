import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsMongoId, IsNotEmpty, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { BoardArticleStatus } from '../../enums/board-article.enum';
import type { ObjectId } from '../../types/common';
import { articleContentMaxLength, articleContentMinLength } from '../../config';

@InputType()
export class BoardArticleUpdate {
	@IsNotEmpty()
	@IsMongoId()
	@Field(() => String)
	_id!: ObjectId;

	@ValidateIf((o: BoardArticleUpdate) => o.articleStatus !== undefined) // reject null: an article always has a status
	@IsEnum(BoardArticleStatus)
	@Field(() => BoardArticleStatus, { nullable: true })
	articleStatus?: BoardArticleStatus;

	@ValidateIf((o: BoardArticleUpdate) => o.articleTitle !== undefined) // reject null: the field is required
	@IsString()
	@Length(3, 50)
	@Field(() => String, { nullable: true })
	articleTitle?: string;

	@ValidateIf((o: BoardArticleUpdate) => o.articleContent !== undefined) // reject null: the field is required
	@IsString()
	@Length(articleContentMinLength, articleContentMaxLength) // D-35
	@Field(() => String, { nullable: true })
	articleContent?: string;

	// null removes the image
	@IsOptional()
	@Field(() => String, { nullable: true })
	articleImage?: string;
}
