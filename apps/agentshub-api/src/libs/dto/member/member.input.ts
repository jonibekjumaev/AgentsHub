import { Field, InputType, Int } from '@nestjs/graphql';
import {
	IsByteLength,
	IsIn,
	IsNotEmpty,
	IsOptional,
	IsString,
	Length,
	Matches,
	MaxLength,
	Min,
	MinLength,
	ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MemberAuthType, MemberStatus, MemberType } from '../../enums/member.enum';
import { Direction, Message } from '../../enums/common.enum';
import {
	aviableCreatorSorts,
	aviableMemberSorts,
	e164PhoneRegex,
	passwordMaxBytes,
	passwordMinLength,
	searchTextMaxLength,
} from '../../config';

@InputType()
export class MemberInput {
	@IsNotEmpty()
	@Length(3, 12)
	@Field(() => String)
	memberNick!: string;

	// new password (D-26): min 8 characters, max 72 bytes, no composition rules
	@IsString()
	@MinLength(passwordMinLength, { message: Message.PASSWORD_TOO_SHORT })
	@IsByteLength(0, passwordMaxBytes, { message: Message.PASSWORD_TOO_LONG })
	@Field(() => String)
	memberPassword!: string;

	@IsNotEmpty()
	@Matches(e164PhoneRegex, { message: Message.INVALID_PHONE }) // E.164 (D-25)
	@Field(() => String)
	memberPhone!: string;

	@IsNotEmpty()
	@IsIn([MemberType.USER, MemberType.CREATOR])
	@Field(() => MemberType)
	memberType!: MemberType;

	@IsOptional()
	@Field(() => MemberAuthType, { nullable: true })
	memberAuthType?: MemberAuthType;
}

@InputType()
export class LoginInput {
	@IsNotEmpty()
	@Length(3, 12)
	@Field(() => String)
	memberNick!: string;

	// only non-empty: existing passwords of any length keep working (D-26)
	@IsNotEmpty()
	@Field(() => String)
	memberPassword!: string;
}

/** The only way to change a password: the logged-in member re-enters the current one (D-24) */
@InputType()
export class ChangePasswordInput {
	// only non-empty: the current password may predate D-26
	@IsNotEmpty()
	@Field(() => String)
	currentPassword!: string;

	// new password (D-26): min 8 characters, max 72 bytes, no composition rules
	@IsString()
	@MinLength(passwordMinLength, { message: Message.PASSWORD_TOO_SHORT })
	@IsByteLength(0, passwordMaxBytes, { message: Message.PASSWORD_TOO_LONG })
	@Field(() => String)
	newPassword!: string;
}

@InputType()
class CRISearch {
	@IsOptional()
	@MaxLength(searchTextMaxLength)
	@Field(() => String, { nullable: true })
	text?: string;
}

@InputType()
export class CreatorsInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit!: number;

	@IsOptional()
	@IsIn(aviableCreatorSorts) // faqat shu array ichidagilarni sort larni qabul qiladi
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => CRISearch)
	@Field(() => CRISearch)
	search!: CRISearch;
}

@InputType()
class MISearch {
	@IsOptional()
	@Field(() => MemberStatus, { nullable: true })
	memberStatus?: MemberStatus;

	@IsOptional()
	@Field(() => MemberType, { nullable: true })
	memberType?: MemberType;

	@IsOptional()
	@MaxLength(searchTextMaxLength)
	@Field(() => String, { nullable: true })
	text?: string;
}

@InputType()
export class MembersInquiry {
	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsNotEmpty()
	@Min(1)
	@Field(() => Int)
	limit!: number;

	@IsOptional()
	@IsIn(aviableMemberSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@Field(() => Direction, { nullable: true })
	direction?: Direction;

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => MISearch)
	@Field(() => MISearch)
	search!: MISearch;
}
