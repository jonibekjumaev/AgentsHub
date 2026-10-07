import { Field, Float, InputType, Int } from '@nestjs/graphql';
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsEnum,
	IsIn,
	IsMongoId,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	IsUrl,
	Length,
	Matches,
	MaxLength,
	Min,
	ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductPricing, ProductStatus } from '../../enums/product.enum';
import { AgentCategory } from '../../enums/agent-category.enum';
import type { ObjectId } from '../../types/common';
import {
	aviableProductSorts,
	productDemoUrlMaxLength,
	productDescMaxLength,
	productDescMinLength,
	productTagMaxLength,
	productTagsMaxCount,
	searchTextMaxLength,
} from '../../config';
import { Direction } from '../../enums/common.enum';

@InputType()
export class ProductInput {
	@IsNotEmpty()
	@Field(() => AgentCategory)
	productCategory!: AgentCategory;

	@IsNotEmpty()
	@Field(() => ProductPricing)
	productPricing!: ProductPricing;

	@IsNotEmpty()
	@Field(() => String)
	@Length(3, 100)
	productTitle!: string;

	// required and > 0 for ONE_TIME / SUBSCRIPTION, absent for FREE / CUSTOM: checked in ProductService (D-03)
	@IsOptional()
	@IsNumber()
	@Field(() => Float, { nullable: true })
	productPrice?: number;

	@IsOptional()
	@IsUrl({ protocols: ['http', 'https'], require_protocol: true })
	@MaxLength(productDemoUrlMaxLength)
	@Field(() => String, { nullable: true })
	productDemoUrl?: string;

	// saved normalized: trimmed, lowercased, without duplicates (normalizeTags)
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(productTagsMaxCount)
	@IsString({ each: true })
	@Length(1, productTagMaxLength, { each: true })
	@Matches(/\S/, { each: true, message: 'each tag must contain a non-space character' })
	@Field(() => [String], { nullable: true })
	productTags?: string[];

	@IsNotEmpty()
	@ArrayMinSize(1)
	@Field(() => [String])
	productImages!: string[];

	@IsNotEmpty()
	@Length(productDescMinLength, productDescMaxLength)
	@Field(() => String)
	productDesc!: string;

	memberId?: ObjectId;
}

@InputType()
export class PricesRange {
	@IsNumber()
	@Min(0)
	@Field(() => Float)
	start!: number;

	@IsNumber()
	@Min(0)
	@Field(() => Float)
	end!: number;
}

@InputType()
export class PeriodsRange {
	@Field(() => Date)
	start!: Date;

	@Field(() => Date)
	end!: Date;
}

// Filters shared by every product list (Step 6 part 13). ProductService applies them in shapeMatchQuery;
// pricesRange only matches ONE_TIME / SUBSCRIPTION products there (D-03)
@InputType({ isAbstract: true })
export abstract class ProductFilters {
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(Object.values(AgentCategory).length)
	@IsEnum(AgentCategory, { each: true })
	@Field(() => [AgentCategory], { nullable: true })
	categoryList?: AgentCategory[];

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(Object.values(ProductPricing).length)
	@IsEnum(ProductPricing, { each: true })
	@Field(() => [ProductPricing], { nullable: true })
	pricingList?: ProductPricing[];

	@IsOptional()
	@ValidateNested()
	@Type(() => PricesRange)
	@Field(() => PricesRange, { nullable: true })
	pricesRange?: PricesRange;

	// a product must have all of these tags; normalized like productTags before matching (normalizeTags)
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(productTagsMaxCount)
	@IsString({ each: true })
	@Length(1, productTagMaxLength, { each: true })
	@Matches(/\S/, { each: true, message: 'each tag must contain a non-space character' })
	@Field(() => [String], { nullable: true })
	tagList?: string[];

	@IsOptional()
	@MaxLength(searchTextMaxLength)
	@Field(() => String, { nullable: true })
	text?: string;
}

@InputType()
export class PIsearch extends ProductFilters {
	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	memberId?: ObjectId;

	@IsOptional()
	@Field(() => PeriodsRange, { nullable: true })
	periodsRange?: PeriodsRange;
}

@InputType()
export class ProductsInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit!: number;

	@IsOptional()
	@IsIn(aviableProductSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	// without @ValidateNested + @Type the rules inside search are never checked
	@IsNotEmpty()
	@ValidateNested()
	@Type(() => PIsearch)
	@Field(() => PIsearch)
	search!: PIsearch;
}

// the creator's own list: memberId is always the caller
@InputType()
class CPISearch extends ProductFilters {
	@IsOptional()
	@Field(() => ProductStatus, { nullable: true })
	productStatus?: ProductStatus;
}

@InputType()
export class CreatorProductsInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit!: number;

	@IsOptional()
	@IsIn(aviableProductSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => CPISearch)
	@Field(() => CPISearch)
	search!: CPISearch;
}

@InputType()
class ALPISearch extends ProductFilters {
	@IsOptional()
	@Field(() => ProductStatus, { nullable: true })
	productStatus?: ProductStatus;

	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	memberId?: ObjectId;

	@IsOptional()
	@Field(() => PeriodsRange, { nullable: true })
	periodsRange?: PeriodsRange;
}

@InputType()
export class AllProductsInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit!: number;

	@IsOptional()
	@IsIn(aviableProductSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => ALPISearch)
	@Field(() => ALPISearch)
	search!: ALPISearch;
}
