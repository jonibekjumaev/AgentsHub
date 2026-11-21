import { Schema } from 'mongoose';
import { EmbeddingStatus } from '../libs/enums/embedding.enum';
import { BriefStatus } from '../libs/enums/brief.enum';
import { AgentCategory } from '../libs/enums/agent-category.enum';

const BriefSchema = new Schema(
	{
		briefCategory: {
			type: String,
			enum: AgentCategory,
			required: true,
		},

		briefStatus: {
			type: String,
			enum: BriefStatus,
			default: BriefStatus.OPEN,
		},

		briefTitle: {
			type: String,
			required: true,
		},

		briefContent: {
			type: String,
			required: true,
		},

		// optional, > 0 if given (D-04); USD (D-06). The rule is checked in BriefService, not here
		briefBudget: {
			type: Number,
		},

		// optional, in the future when set (D-05, D-31). The rule is checked in BriefService, not here
		briefDeadline: {
			type: Date,
		},

		briefViews: {
			type: Number,
			default: 0,
		},

		briefComments: {
			type: Number,
			default: 0,
		},

		// D-48: PENDING + ACCEPTED offers. Changed only by OfferService; a brief stored before D-48 has none (read as 0)
		briefOffers: {
			type: Number,
			default: 0,
		},

		memberId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		closedAt: {
			type: Date,
		},

		deletedAt: {
			type: Date,
		},

		// D-52: the vector of the search text (title, category, tags/description), for $vectorSearch. Never selected by
		// default and never in GraphQL; written only by EmbeddingSyncService, without touching updatedAt
		embedding: {
			type: [Number],
			select: false,
			default: undefined,
		},

		embeddingStatus: {
			type: String,
			enum: EmbeddingStatus,
			default: EmbeddingStatus.PENDING,
		},

		// the model that made `embedding`; a different configured model makes the document PENDING again
		embeddingModel: {
			type: String,
		},

		// sha256 of the text the vector was made from: the same text is never sent twice
		embeddingHash: {
			type: String,
		},

		embeddingAttempts: {
			type: Number,
			default: 0,
		},

		embeddedAt: {
			type: Date,
		},
	},
	{ timestamps: true, collection: 'briefs' },
);

BriefSchema.index({ memberId: 1, briefStatus: 1 });
BriefSchema.index({ briefCategory: 1, briefStatus: 1, createdAt: -1 });
// D-52: the reconcile job's lookup of documents without a current vector
BriefSchema.index({ embeddingStatus: 1 });
// D-53: the keyword half of the hybrid search ($text). A collection can have one text index; a title word weighs most
BriefSchema.index(
	{ briefTitle: 'text', briefContent: 'text' },
	{ name: 'brief_text', weights: { briefTitle: 10, briefContent: 1 } },
);

export default BriefSchema;
