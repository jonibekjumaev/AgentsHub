import { Schema } from 'mongoose';

/**
 * D-49: the 1:1 conversation of one offer, between the brief's owner and the offer's creator. Whether it takes new
 * messages is computed from the offer and the members (ChatService), not stored; only the admin lock is.
 */
const ConversationSchema = new Schema(
	{
		offerId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Offer',
		},

		briefId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Brief',
		},

		// the brief's owner, who opened it
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

		lastMessageAt: {
			type: Date,
		},

		// the start of the last message, for the conversation list
		lastMessagePreview: {
			type: String,
		},

		lastSenderId: {
			type: Schema.Types.ObjectId,
			ref: 'Member',
		},

		// messages each side hasn't read yet
		userUnread: {
			type: Number,
			default: 0,
		},

		creatorUnread: {
			type: Number,
			default: 0,
		},

		lockedByAdmin: {
			type: Boolean,
			default: false,
		},
	},
	{ timestamps: true, collection: 'conversations' },
);

// one conversation per offer
ConversationSchema.index({ offerId: 1 }, { unique: true });
// each side's list, latest message first
ConversationSchema.index({ userId: 1, lastMessageAt: -1 });
ConversationSchema.index({ creatorId: 1, lastMessageAt: -1 });

export default ConversationSchema;
