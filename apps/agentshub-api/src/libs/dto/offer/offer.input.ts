import { Field, Float, InputType, Int } from '@nestjs/graphql';
import {
	IsEnum,
	IsInt,
	IsMongoId,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsPositive,
	Length,
	Max,
	Min,
	ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { ObjectId } from '../../types/common';
import { OfferStatus } from '../../enums/offer.enum';
import { Message } from '../../enums/common.enum';
import {
	listPageMax,
	offerDeliveryDaysMax,
	offerDeliveryDaysMin,
	offerMessageMaxLength,
	offerMessageMinLength,
} from '../../config';

/**
 * The length rule counts the trimmed message (D-48). The global ValidationPipe validates a transformed copy and passes
 * the original on, so OfferService trims again before it stores the message.
 */
const trimmed = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** D-48: send an offer, or send it again after WITHDRAWN / EXPIRED (or a brief that closed and reopened). */
@InputType()
export class OfferInput {
	@IsNotEmpty()
	@IsMongoId()
	@Field(() => String)
	briefId!: ObjectId;

	// USD (D-06), > 0 like briefBudget (D-04)
	@IsNotEmpty()
	@IsNumber()
	@IsPositive({ message: Message.INVALID_OFFER_PRICE })
	@Field(() => Float)
	offerPrice!: number;

	@IsNotEmpty()
	@IsInt()
	@Min(offerDeliveryDaysMin)
	@Max(offerDeliveryDaysMax)
	@Field(() => Int)
	offerDeliveryDays!: number;

	@IsNotEmpty()
	@trimmed
	@Length(offerMessageMinLength, offerMessageMaxLength)
	@Field(() => String)
	offerMessage!: string;

	// one of the creator's ACTIVE agents: checked in OfferService
	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	productId?: ObjectId;
}

/** D-48: edit a PENDING offer. Fields left out don't change; productId null detaches the agent. Restarts the expiry. */
@InputType()
export class OfferUpdate {
	@IsNotEmpty()
	@IsMongoId()
	@Field(() => String)
	_id!: ObjectId;

	@IsOptional()
	@IsNumber()
	@IsPositive({ message: Message.INVALID_OFFER_PRICE })
	@Field(() => Float, { nullable: true })
	offerPrice?: number;

	@IsOptional()
	@IsInt()
	@Min(offerDeliveryDaysMin)
	@Max(offerDeliveryDaysMax)
	@Field(() => Int, { nullable: true })
	offerDeliveryDays?: number;

	@IsOptional()
	@trimmed
	@Length(offerMessageMinLength, offerMessageMaxLength)
	@Field(() => String, { nullable: true })
	offerMessage?: string;

	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	productId?: ObjectId | null;
}

@InputType()
class MOISearch {
	// every status when left out; EXPIRED includes PENDING offers past their expiry
	@IsOptional()
	@IsEnum(OfferStatus)
	@Field(() => OfferStatus, { nullable: true })
	offerStatus?: OfferStatus;
}

/** D-48: the caller's own offers (a creator). */
@InputType()
export class MyOffersInquiry {
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

	@IsOptional()
	@ValidateNested()
	@Type(() => MOISearch)
	@Field(() => MOISearch, { nullable: true })
	search?: MOISearch;
}

@InputType()
class BOISearch {
	@IsNotEmpty()
	@IsMongoId()
	@Field(() => String)
	briefId!: ObjectId;

	@IsOptional()
	@IsEnum(OfferStatus)
	@Field(() => OfferStatus, { nullable: true })
	offerStatus?: OfferStatus;
}

/** D-48: the offers on one of the caller's briefs (the brief's owner). */
@InputType()
export class BriefOffersInquiry {
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

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => BOISearch)
	@Field(() => BOISearch)
	search!: BOISearch;
}
