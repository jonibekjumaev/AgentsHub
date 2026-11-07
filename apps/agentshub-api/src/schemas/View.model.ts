import { Schema } from 'mongoose';
import { ViewGroup } from '../libs/enums/view.enum';

const ViewSchema = new Schema(
	{
		viewGroup: {
			type: String,
			enum: ViewGroup,
			required: true,
		},

		viewRefId: {
			type: Schema.Types.ObjectId,
			required: true,
		},

		memberId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},
	},
	{ timestamps: true, collection: 'views' },
);

ViewSchema.index({ memberId: 1, viewRefId: 1 }, { unique: true });
// "Who viewed your profile" (D-42): one profile's visits, newest first
ViewSchema.index({ viewRefId: 1, viewGroup: 1, updatedAt: -1 });

export default ViewSchema;
