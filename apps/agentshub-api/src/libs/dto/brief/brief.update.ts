import { Field, Float, InputType } from '@nestjs/graphql';
import {
	IsDate,
	IsEnum,
	IsMongoId,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsPositive,
	IsString,
	Length,
	ValidateIf,
} from 'class-validator';
import { BriefStatus } from '../../enums/brief.enum';
import { AgentCategory } from '../../enums/agent-category.enum';
import { Message } from '../../enums/common.enum';
import type { ObjectId } from '../../types/common';
import { briefContentMaxLength, briefContentMinLength, briefTitleMaxLength, briefTitleMinLength } from '../../config';

@InputType()
export class BriefUpdate {
	@IsNotEmpty()
	@IsMongoId()
	@Field(() => String)
	_id!: ObjectId;

	@ValidateIf((o: BriefUpdate) => o.briefCategory !== undefined) // reject null: the field is required
	@IsEnum(AgentCategory)
	@Field(() => AgentCategory, { nullable: true })
	briefCategory?: AgentCategory;

	// reject null (B11). The allowed status changes are checked in BriefService (D-30)
	@ValidateIf((o: BriefUpdate) => o.briefStatus !== undefined)
	@IsEnum(BriefStatus)
	@Field(() => BriefStatus, { nullable: true })
	briefStatus?: BriefStatus;

	@ValidateIf((o: BriefUpdate) => o.briefTitle !== undefined) // reject null: the field is required
	@IsString()
	@Length(briefTitleMinLength, briefTitleMaxLength)
	@Field(() => String, { nullable: true })
	briefTitle?: string;

	@ValidateIf((o: BriefUpdate) => o.briefContent !== undefined) // reject null and '': the field is required
	@IsString()
	@Length(briefContentMinLength, briefContentMaxLength)
	@Field(() => String, { nullable: true })
	briefContent?: string;

	// leave out to keep the stored budget, null clears it ("open to offers", D-04)
	@IsOptional()
	@IsNumber()
	@IsPositive({ message: Message.INVALID_BUDGET })
	@Field(() => Float, { nullable: true })
	briefBudget?: number;

	// leave out to keep the stored deadline, null clears it. In the future when sent or on reopen: BriefService (D-31)
	@IsOptional()
	@IsDate()
	@Field(() => Date, { nullable: true })
	briefDeadline?: Date;
}
