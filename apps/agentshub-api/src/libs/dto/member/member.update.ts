import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { MemberStatus } from '../../enums/member.enum';
import { Message } from '../../enums/common.enum';
import type { ObjectId } from '../../types/common';
import { memberEmailMaxLength, whatsappNumberRegex } from '../../config';

@InputType()
export class MemberUpdate {
	@IsOptional()
	@Field(() => String, { nullable: true })
	memberPhone?: string;

	@IsOptional()
	@Length(3, 12)
	@Field(() => String, { nullable: true })
	memberNick?: string;

	@IsOptional()
	@Length(5, 12)
	@Field(() => String, { nullable: true })
	memberPassword?: string;

	@IsOptional()
	@Length(3, 100)
	@Field(() => String, { nullable: true })
	memberFullName?: string;

	@ValidateIf((o) => o.memberImage !== undefined) // reject null; send '' to remove the image (D-15)
	@IsString()
	@Field(() => String, { nullable: true })
	memberImage?: string;

	// Write-only until D-07: not a field on the Member output type yet. Send null to remove the contact.
	@IsOptional()
	@IsEmail({}, { message: Message.INVALID_EMAIL })
	@MaxLength(memberEmailMaxLength, { message: Message.INVALID_EMAIL })
	@Field(() => String, { nullable: true })
	memberEmail?: string;

	@IsOptional()
	@Matches(whatsappNumberRegex, { message: Message.INVALID_WHATSAPP })
	@Field(() => String, { nullable: true })
	memberWhatsapp?: string;

	@IsOptional()
	@Field(() => String, { nullable: true })
	memberDesc?: string;

	deletedAt?: Date;
}

@InputType()
export class MemberUpdateByAdmin {
	@IsNotEmpty()
	@Field(() => String)
	_id!: ObjectId;

	@IsOptional()
	@Field(() => MemberStatus, { nullable: true })
	memberStatus?: MemberStatus;

	@IsOptional()
	@Field(() => String, { nullable: true })
	memberPhone?: string;

	@IsOptional()
	@Length(3, 12)
	@Field(() => String, { nullable: true })
	memberNick?: string;

	@IsOptional()
	@Length(5, 12)
	@Field(() => String, { nullable: true })
	memberPassword?: string;

	@IsOptional()
	@Length(3, 100)
	@Field(() => String, { nullable: true })
	memberFullName?: string;

	@ValidateIf((o) => o.memberImage !== undefined) // reject null; send '' to remove the image (D-15)
	@IsString()
	@Field(() => String, { nullable: true })
	memberImage?: string;

	// Write-only until D-07: not a field on the Member output type yet. Send null to remove the contact.
	@IsOptional()
	@IsEmail({}, { message: Message.INVALID_EMAIL })
	@MaxLength(memberEmailMaxLength, { message: Message.INVALID_EMAIL })
	@Field(() => String, { nullable: true })
	memberEmail?: string;

	@IsOptional()
	@Matches(whatsappNumberRegex, { message: Message.INVALID_WHATSAPP })
	@Field(() => String, { nullable: true })
	memberWhatsapp?: string;

	@IsOptional()
	@Field(() => String, { nullable: true })
	memberDesc?: string;

	deletedAt?: Date;
}
