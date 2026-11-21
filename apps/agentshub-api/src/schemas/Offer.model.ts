import { Schema } from 'mongoose';
import { OfferCloseReason, OfferStatus } from '../libs/enums/offer.enum';

/**
 * D-48: a creator's offer on a brief. One document per creator and brief for its whole life: sending again after
 * WITHDRAWN or EXPIRED re-opens it. The rules (who, which moves, limits) live in OfferService, not here.
 */
const OfferSchema = new Schema(
	{
		briefId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Brief',
		},

		creatorId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		// the brief's owner, copied from the brief so "offers on my briefs" needs no join
		userId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		// optional: one of the creator's ACTIVE agents
		productId: {
			type: Schema.Types.ObjectId,
			ref: 'Product',
		},

		offerStatus: {
			type: String,
			enum: OfferStatus,
			default: OfferStatus.PENDING,
		},

		offerCloseReason: {
			type: String,
			enum: OfferCloseReason,
		},

		// USD (D-06), > 0
		offerPrice: {
			type: Number,
			required: true,
		},

		offerDeliveryDays: {
			type: Number,
			required: true,
		},

		offerMessage: {
			type: String,
			required: true,
		},

		// first sent, or last re-sent: the lists sort by it and the daily limit counts it
		sentAt: {
			type: Date,
			required: true,
		},

		// PENDING only: last sent or edited + offerExpiryDays
		expiresAt: {
			type: Date,
		},

		// set when the offer leaves PENDING
		closedAt: {
			type: Date,
		},
	},
	{ timestamps: true, collection: 'offers' },
);

// one offer per creator and brief; also Brief.meOffer
OfferSchema.index({ briefId: 1, creatorId: 1 }, { unique: true });
// the brief owner's list of a brief's offers (getBriefOffers)
OfferSchema.index({ briefId: 1, offerStatus: 1, sentAt: -1 });
// a creator's offers (getMyOffers)
OfferSchema.index({ creatorId: 1, offerStatus: 1, sentAt: -1 });
// the daily limit
OfferSchema.index({ creatorId: 1, sentAt: -1 });
// the expiry job
OfferSchema.index({ offerStatus: 1, expiresAt: 1 });

export default OfferSchema;
