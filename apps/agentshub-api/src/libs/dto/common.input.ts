import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsNotEmpty, Max, Min } from 'class-validator';
import { listPageMax } from '../config';

@InputType()
export class OrdinaryInquiry {
	@IsInt()
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsInt()
	@IsNotEmpty()
	@Min(1)
	@Max(listPageMax)
	@Field(() => Int)
	limit!: number;
}
