import { Field, Float, InputType } from '@nestjs/graphql';
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsEnum,
	IsIn,
	IsNotEmpty,
	IsOptional,
	IsString,
	IsUrl,
	Length,
	Matches,
	MaxLength,
	ValidateIf,
} from 'class-validator';
import { ProductPricing, ProductStatus } from '../../enums/product.enum';
import { AgentCategory } from '../../enums/agent-category.enum';
import type { ObjectId } from '../../types/common';
import {
	productDemoUrlMaxLength,
	productDescMaxLength,
	productDescMinLength,
	productTagMaxLength,
	productTagsMaxCount,
} from '../../config';

@InputType()
export class ProductUpdate {
	@IsNotEmpty()
	@Field(() => String)
	_id!: ObjectId;

	@ValidateIf((o) => o.productCategory !== undefined) // reject null: the field is required
	@IsEnum(AgentCategory)
	@Field(() => AgentCategory, { nullable: true })
	productCategory?: AgentCategory;

	@IsOptional()
	@IsIn([ProductStatus.ACTIVE, ProductStatus.DELETE]) // temporary until the D-16 part: PAUSED is not supported yet
	@Field(() => ProductStatus, { nullable: true })
	productStatus?: ProductStatus;

	@ValidateIf((o) => o.productPricing !== undefined) // reject null: the field is required
	@IsEnum(ProductPricing)
	@Field(() => ProductPricing, { nullable: true })
	productPricing?: ProductPricing;

	@ValidateIf((o) => o.productTitle !== undefined) // reject null: the field is required
	@IsString()
	@Length(3, 100)
	@Field(() => String, { nullable: true })
	productTitle?: string;

	@IsOptional()
	@Field(() => Float, { nullable: true })
	productPrice?: number;

	// null removes the demo link
	@IsOptional()
	@IsUrl({ protocols: ['http', 'https'], require_protocol: true })
	@MaxLength(productDemoUrlMaxLength)
	@Field(() => String, { nullable: true })
	productDemoUrl?: string;

	// reject null; send [] to remove all tags. Saved normalized (normalizeTags)
	@ValidateIf((o) => o.productTags !== undefined)
	@IsArray()
	@ArrayMaxSize(productTagsMaxCount)
	@IsString({ each: true })
	@Length(1, productTagMaxLength, { each: true })
	@Matches(/\S/, { each: true, message: 'each tag must contain a non-space character' })
	@Field(() => [String], { nullable: true })
	productTags?: string[];

	@ValidateIf((o) => o.productImages !== undefined) // reject null and []: at least 1 image
	@IsArray()
	@ArrayMinSize(1)
	@Field(() => [String], { nullable: true })
	productImages?: string[];

	@ValidateIf((o) => o.productDesc !== undefined) // reject null and '': the description can't be cleared (D-18)
	@IsString()
	@Length(productDescMinLength, productDescMaxLength)
	@Field(() => String, { nullable: true })
	productDesc?: string;

	deletedAt?: Date;
}
