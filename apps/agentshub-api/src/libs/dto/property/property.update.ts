import { Field, Float, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, Length } from 'class-validator';
import { PropertyStatus } from '../../enums/property.enum';
import type { ObjectId } from '../../types/common';

@InputType()
export class PropertyUpdate {
	@IsNotEmpty()
	@Field(() => String)
	_id!: ObjectId;

	@IsOptional()
	@Field(() => PropertyStatus, { nullable: true })
	propertyStatus?: PropertyStatus;

	@IsOptional()
	@Field(() => String, { nullable: true })
	@Length(3, 100)
	propertyTitle?: string;

	@IsOptional()
	@Field(() => Float, { nullable: true })
	propertyPrice?: number;

	@IsOptional()
	@Field(() => [String], { nullable: true })
	propertyImages?: string[];

	@IsOptional()
	@Length(5, 500)
	@Field(() => String, { nullable: true })
	propertyDesc?: string;

	deletedAt?: Date;
}
