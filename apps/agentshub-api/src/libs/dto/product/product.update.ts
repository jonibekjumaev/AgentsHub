import { Field, Float, InputType } from '@nestjs/graphql';
import { IsIn, IsNotEmpty, IsOptional, Length } from 'class-validator';
import { ProductStatus } from '../../enums/product.enum';
import type { ObjectId } from '../../types/common';

@InputType()
export class ProductUpdate {
	@IsNotEmpty()
	@Field(() => String)
	_id!: ObjectId;

	@IsOptional()
	@IsIn([ProductStatus.ACTIVE, ProductStatus.DELETE]) // temporary until the D-16 part: PAUSED is not supported yet
	@Field(() => ProductStatus, { nullable: true })
	productStatus?: ProductStatus;

	@IsOptional()
	@Field(() => String, { nullable: true })
	@Length(3, 100)
	productTitle?: string;

	@IsOptional()
	@Field(() => Float, { nullable: true })
	productPrice?: number;

	@IsOptional()
	@Field(() => [String], { nullable: true })
	productImages?: string[];

	@IsOptional()
	@Length(5, 500)
	@Field(() => String, { nullable: true })
	productDesc?: string;

	deletedAt?: Date;
}
