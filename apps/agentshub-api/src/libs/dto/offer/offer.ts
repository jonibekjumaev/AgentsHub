import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from '../../types/common';
import { OfferCloseReason, OfferStatus } from '../../enums/offer.enum';
import { Member, TotalCounter } from '../member/member';
import { Product } from '../product/product';
import { Brief } from '../brief/brief';

/**
 * D-48: a creator's offer on a brief. Readable only by its creator, the brief's owner and an admin.
 *
 * `offerStatus` is the status the caller should see: a PENDING offer past `expiresAt` is answered as EXPIRED even
 * before the daily expiry job has stored it.
 */
@ObjectType()
export class Offer {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => String)
	briefId!: ObjectId;

	@Field(() => String)
	creatorId!: ObjectId;

	/** the brief's owner */
	@Field(() => String)
	userId!: ObjectId;

	@Field(() => String, { nullable: true })
	productId?: ObjectId;

	@Field(() => OfferStatus)
	offerStatus!: OfferStatus;

	@Field(() => OfferCloseReason, { nullable: true })
	offerCloseReason?: OfferCloseReason;

	/** USD (D-06) */
	@Field(() => Float)
	offerPrice!: number;

	@Field(() => Int)
	offerDeliveryDays!: number;

	@Field(() => String)
	offerMessage!: string;

	@Field(() => Date)
	sentAt!: Date;

	/** PENDING only */
	@Field(() => Date, { nullable: true })
	expiresAt?: Date;

	@Field(() => Date, { nullable: true })
	closedAt?: Date;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;

	/** from aggregation */

	/** the brief, on the creator's list (getMyOffers) */
	@Field(() => Brief, { nullable: true })
	briefData?: Brief;

	/** null for a deleted creator (D-38) */
	@Field(() => Member, { nullable: true })
	creatorData?: Member;

	/** the attached agent while it is ACTIVE; null otherwise */
	@Field(() => Product, { nullable: true })
	productData?: Product;

	/** on the owner's list (getBriefOffers): whether the owner invited this creator */
	@Field(() => Boolean, { nullable: true })
	invited?: boolean;
}

@ObjectType()
export class Offers {
	@Field(() => [Offer])
	list!: Offer[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter!: TotalCounter[];
}
