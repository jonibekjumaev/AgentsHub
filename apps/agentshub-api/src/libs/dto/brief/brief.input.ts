import { Field, Float, InputType } from '@nestjs/graphql';
import { IsDate, IsNotEmpty, IsNumber, IsOptional, IsPositive, Length } from 'class-validator';
import { AgentCategory } from '../../enums/agent-category.enum';
import { Message } from '../../enums/common.enum';
import type { ObjectId } from '../../types/common';
import { briefContentMaxLength, briefContentMinLength, briefTitleMaxLength, briefTitleMinLength } from '../../config';

@InputType()
export class BriefInput {
	@IsNotEmpty()
	@Field(() => AgentCategory)
	briefCategory!: AgentCategory;

	@IsNotEmpty()
	@Length(briefTitleMinLength, briefTitleMaxLength)
	@Field(() => String)
	briefTitle!: string;

	@IsNotEmpty()
	@Length(briefContentMinLength, briefContentMaxLength)
	@Field(() => String)
	briefContent!: string;

	// leave out for "open to offers"; > 0 if given (D-04), USD (D-06)
	@IsOptional()
	@IsNumber()
	@IsPositive({ message: Message.INVALID_BUDGET })
	@Field(() => Float, { nullable: true })
	briefBudget?: number;

	// must be in the future: checked in BriefService (D-05)
	@IsOptional()
	@IsDate()
	@Field(() => Date, { nullable: true })
	briefDeadline?: Date;

	memberId?: ObjectId;
}
