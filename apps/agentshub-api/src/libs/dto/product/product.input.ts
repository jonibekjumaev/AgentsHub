import { Field, Float, InputType, Int } from '@nestjs/graphql';
import { IsIn, IsNotEmpty, IsOptional, Length, MaxLength, Min } from 'class-validator';
import { ProductStatus } from '../../enums/product.enum';
import type { ObjectId } from '../../types/common';
import { aviableProductSorts, searchTextMaxLength } from '../../config';
import { Direction } from '../../enums/common.enum';

@InputType()
export class ProductInput {
	@IsNotEmpty()
	@Field(() => String)
	@Length(3, 100)
	productTitle!: string;

	@IsNotEmpty()
	@Field(() => Float)
	productPrice!: number;

	@IsNotEmpty()
	@Field(() => [String])
	productImages!: string[];

	@IsOptional()
	@Length(5, 500)
	@Field(() => String, { nullable: true })
	productDesc?: string;

	memberId?: ObjectId;
}

@InputType()
export class PricesRange {
	@Field(() => Int)
	start!: number;

	@Field(() => Int)
	end!: number;
}

@InputType()
export class PeriodsRange {
	@Field(() => Date)
	start!: Date;

	@Field(() => Date)
	end!: Date;
}

@InputType()
export class PIsearch {
	@IsOptional()
	@Field(() => String, { nullable: true })
	memberId?: ObjectId;

	@IsOptional()
	@Field(() => PricesRange, { nullable: true })
	pricesRange?: PricesRange;

	@IsOptional()
	@Field(() => PeriodsRange, { nullable: true })
	periodsRange?: PeriodsRange;

	@IsOptional()
	@MaxLength(searchTextMaxLength)
	@Field(() => String, { nullable: true })
	text?: string;
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

	@IsNotEmpty()
	@Field(() => PIsearch)
	search!: PIsearch;
}

@InputType()
class CPISearch {
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
	@Field(() => CPISearch)
	search!: CPISearch;
}

@InputType()
class ALPISearch {
	@IsOptional()
	@Field(() => ProductStatus, { nullable: true })
	productStatus?: ProductStatus;
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
	@Field(() => ALPISearch)
	search!: ALPISearch;
}
