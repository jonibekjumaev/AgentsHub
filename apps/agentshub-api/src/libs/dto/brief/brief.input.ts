import { Field, Float, InputType, Int } from '@nestjs/graphql';
import {
	ArrayMaxSize,
	IsArray,
	IsDate,
	IsEnum,
	IsIn,
	IsMongoId,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsPositive,
	Length,
	MaxLength,
	Min,
	ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgentCategory } from '../../enums/agent-category.enum';
import { BriefStatus } from '../../enums/brief.enum';
import { Direction, Message } from '../../enums/common.enum';
import type { ObjectId } from '../../types/common';
import {
	aviableBriefSorts,
	briefContentMaxLength,
	briefContentMinLength,
	briefTitleMaxLength,
	briefTitleMinLength,
	searchTextMaxLength,
} from '../../config';

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

// Filters shared by every brief list. BriefService applies them in shapeMatchQuery
@InputType({ isAbstract: true })
export abstract class BriefFilters {
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(Object.values(AgentCategory).length)
	@IsEnum(AgentCategory, { each: true })
	@Field(() => [AgentCategory], { nullable: true })
	categoryList?: AgentCategory[];

	// matched against briefTitle
	@IsOptional()
	@MaxLength(searchTextMaxLength)
	@Field(() => String, { nullable: true })
	text?: string;
}

// the public list, also used for another member's profile (memberId)
@InputType()
export class BISearch extends BriefFilters {
	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	memberId?: ObjectId;

	// OPEN when left out; DELETE is rejected in BriefService (D-30)
	@IsOptional()
	@IsEnum(BriefStatus)
	@Field(() => BriefStatus, { nullable: true })
	briefStatus?: BriefStatus;
}

@InputType()
export class BriefsInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit!: number;

	@IsOptional()
	@IsIn(aviableBriefSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	// without @ValidateNested + @Type the rules inside search are never checked
	@IsNotEmpty()
	@ValidateNested()
	@Type(() => BISearch)
	@Field(() => BISearch)
	search!: BISearch;
}

// the owner's own list: memberId is always the caller
@InputType()
class MBISearch extends BriefFilters {
	// OPEN and CLOSED when left out; DELETE is rejected in BriefService (D-30)
	@IsOptional()
	@IsEnum(BriefStatus)
	@Field(() => BriefStatus, { nullable: true })
	briefStatus?: BriefStatus;
}

@InputType()
export class MyBriefsInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit!: number;

	@IsOptional()
	@IsIn(aviableBriefSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => MBISearch)
	@Field(() => MBISearch)
	search!: MBISearch;
}
