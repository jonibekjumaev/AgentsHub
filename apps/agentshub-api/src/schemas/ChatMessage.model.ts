import { Schema } from 'mongoose';

/** D-49: one message of a conversation. Plain text; the model is 'ChatMessage' so it can't be confused with Message. */
const ChatMessageSchema = new Schema(
	{
		conversationId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Conversation',
		},

		senderId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		messageText: {
			type: String,
			required: true,
		},

		// made by the client: the same id sent twice (a retry) stores one message
		clientMessageId: {
			type: String,
			required: true,
		},
	},
	{ timestamps: true, collection: 'messages' },
);

// a conversation's history, by cursor
ChatMessageSchema.index({ conversationId: 1, _id: -1 });
// retries
ChatMessageSchema.index({ senderId: 1, clientMessageId: 1 }, { unique: true });
// the rate limit
ChatMessageSchema.index({ senderId: 1, createdAt: -1 });

export default ChatMessageSchema;
