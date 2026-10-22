import { Field, InputType } from '@nestjs/graphql';
import {
	IsEmail,
	IsEnum,
	IsMongoId,
	IsNotEmpty,
	IsOptional,
	IsString,
	Length,
	Matches,
	MaxLength,
	ValidateIf,
} from 'class-validator';
import { MemberStatus } from '../../enums/member.enum';
import { Message } from '../../enums/common.enum';
import type { ObjectId } from '../../types/common';
import { e164PhoneRegex, memberDescMaxLength, memberEmailMaxLength } from '../../config';

@InputType()
export class MemberUpdate {
	@ValidateIf((o: MemberUpdate) => o.memberPhone !== undefined) // reject null: the field is required (B11)
	@IsString()
	@Matches(e164PhoneRegex, { message: Message.INVALID_PHONE }) // E.164 (D-25)
	@Field(() => String, { nullable: true })
	memberPhone?: string;

	@ValidateIf((o: MemberUpdate) => o.memberNick !== undefined) // reject null: the field is required
	@IsString()
	@Length(3, 12)
	@Field(() => String, { nullable: true })
	memberNick?: string;

	@IsOptional()
	@Length(3, 100)
	@Field(() => String, { nullable: true })
	memberFullName?: string;

	@ValidateIf((o: MemberUpdate) => o.memberImage !== undefined) // reject null; send '' to remove the image (D-15)
	@IsString()
	@Field(() => String, { nullable: true })
	memberImage?: string;

	// Returned only to logged-in members (D-07, D-23). Send null to remove the contact.
	@IsOptional()
	@IsEmail({}, { message: Message.INVALID_EMAIL })
	@MaxLength(memberEmailMaxLength, { message: Message.INVALID_EMAIL })
	@Field(() => String, { nullable: true })
	memberEmail?: string;

	@IsOptional()
	@Matches(e164PhoneRegex, { message: Message.INVALID_WHATSAPP })
	@Field(() => String, { nullable: true })
	memberWhatsapp?: string;

	@IsOptional()
	@MaxLength(memberDescMaxLength) // D-35; null still clears it
	@Field(() => String, { nullable: true })
	memberDesc?: string;

	deletedAt?: Date;
}

@InputType()
export class MemberUpdateByAdmin {
	@IsNotEmpty()
	@IsMongoId()
	@Field(() => String)
	_id!: ObjectId;

	@ValidateIf((o: MemberUpdateByAdmin) => o.memberStatus !== undefined) // reject null: a member always has a status
	@IsEnum(MemberStatus)
	@Field(() => MemberStatus, { nullable: true })
	memberStatus?: MemberStatus;

	@ValidateIf((o: MemberUpdateByAdmin) => o.memberPhone !== undefined) // reject null: the field is required (B11)
	@IsString()
	@Matches(e164PhoneRegex, { message: Message.INVALID_PHONE }) // E.164 (D-25)
	@Field(() => String, { nullable: true })
	memberPhone?: string;

	@ValidateIf((o: MemberUpdateByAdmin) => o.memberNick !== undefined) // reject null: the field is required
	@IsString()
	@Length(3, 12)
	@Field(() => String, { nullable: true })
	memberNick?: string;

	@IsOptional()
	@Length(3, 100)
	@Field(() => String, { nullable: true })
	memberFullName?: string;

	@ValidateIf((o: MemberUpdateByAdmin) => o.memberImage !== undefined) // reject null; send '' to remove the image (D-15)
	@IsString()
	@Field(() => String, { nullable: true })
	memberImage?: string;

	// Returned only to logged-in members (D-07, D-23). Send null to remove the contact.
	@IsOptional()
	@IsEmail({}, { message: Message.INVALID_EMAIL })
	@MaxLength(memberEmailMaxLength, { message: Message.INVALID_EMAIL })
	@Field(() => String, { nullable: true })
	memberEmail?: string;

	@IsOptional()
	@Matches(e164PhoneRegex, { message: Message.INVALID_WHATSAPP })
	@Field(() => String, { nullable: true })
	memberWhatsapp?: string;

	@IsOptional()
	@MaxLength(memberDescMaxLength) // D-35; null still clears it
	@Field(() => String, { nullable: true })
	memberDesc?: string;

	deletedAt?: Date;
}
