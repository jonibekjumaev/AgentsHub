import { Field, InputType, Int } from '@nestjs/graphql';
import { IsIn, IsNotEmpty, IsOptional, Length, Matches, MaxLength, Min } from 'class-validator';
import { MemberAuthType, MemberStatus, MemberType } from '../../enums/member.enum';
import { Direction, Message } from '../../enums/common.enum';
import { aviableCreatorSorts, aviableMemberSorts, e164PhoneRegex, searchTextMaxLength } from '../../config';

@InputType()
export class MemberInput {
	@IsNotEmpty()
	@Length(3, 12)
	@Field(() => String)
	memberNick!: string;

	@IsNotEmpty()
	@Length(5, 12)
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

	@IsNotEmpty()
	@Length(5, 12)
	@Field(() => String)
	memberPassword!: string;
}

/** The only way to change a password: the logged-in member re-enters the current one (D-24) */
@InputType()
export class ChangePasswordInput {
	@IsNotEmpty()
	@Length(5, 12)
	@Field(() => String)
	currentPassword!: string;

	@IsNotEmpty()
	@Length(5, 12)
	@Field(() => String)
	newPassword!: string;
}

@InputType()
class CRISearch {
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
	@Field(() => MISearch)
	search!: MISearch;
}
