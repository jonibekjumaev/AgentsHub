import { Schema } from 'mongoose';

/** D-47: a member's private bookmark of a brief ("Save brief"). No counters: nobody but the member ever sees it. */
const SaveSchema = new Schema(
	{
		memberId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		briefId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Brief',
		},
	},
	{ timestamps: true, collection: 'saves' },
);

// one save per member and brief; also the "is it saved" check (getBrief, the meSaved lookup)
SaveSchema.index({ memberId: 1, briefId: 1 }, { unique: true });
// one member's saved briefs, latest saved first (getSavedBriefs)
SaveSchema.index({ memberId: 1, createdAt: -1 });

export default SaveSchema;
