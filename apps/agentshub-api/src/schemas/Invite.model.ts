import { Schema } from 'mongoose';

/** D-48: a brief's owner asks a creator to send an offer ("invite to job"). The price still comes from the creator. */
const InviteSchema = new Schema(
	{
		briefId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Brief',
		},

		// the brief's owner
		userId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		creatorId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},
	},
	{ timestamps: true, collection: 'invites' },
);

// one invite per creator and brief; also Brief.meInvited and the "Invited" mark on an offer
InviteSchema.index({ briefId: 1, creatorId: 1 }, { unique: true });
// a creator's invites, latest first (getMyInvites)
InviteSchema.index({ creatorId: 1, createdAt: -1 });
// the daily limit
InviteSchema.index({ userId: 1, createdAt: -1 });

export default InviteSchema;
