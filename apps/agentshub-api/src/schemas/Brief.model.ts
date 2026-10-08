import { Schema } from 'mongoose';
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
	},
	{ timestamps: true, collection: 'briefs' },
);

BriefSchema.index({ memberId: 1, briefStatus: 1 });
BriefSchema.index({ briefCategory: 1, briefStatus: 1, createdAt: -1 });

export default BriefSchema;
