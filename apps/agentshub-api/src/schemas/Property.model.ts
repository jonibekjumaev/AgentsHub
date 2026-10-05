import { Schema } from 'mongoose';
import { PropertyStatus } from '../libs/enums/property.enum';

const PropertySchema = new Schema(
	{
		propertyStatus: {
			type: String,
			enum: PropertyStatus,
			default: PropertyStatus.ACTIVE,
		},

		propertyTitle: {
			type: String,
			required: true,
		},

		propertyPrice: {
			type: Number,
			required: true,
		},

		propertyViews: {
			type: Number,
			default: 0,
		},

		propertyLikes: {
			type: Number,
			default: 0,
		},

		propertyComments: {
			type: Number,
			default: 0,
		},

		propertyRank: {
			type: Number,
			default: 0,
		},

		propertyImages: {
			type: [String],
			required: true,
		},

		propertyDesc: {
			type: String,
		},

		memberId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		deletedAt: {
			type: Date,
		},
	},
	{ timestamps: true, collection: 'properties' },
);

PropertySchema.index({ memberId: 1, propertyTitle: 1 }, { unique: true });
PropertySchema.index({ memberId: 1, propertyStatus: 1 });
PropertySchema.index({ propertyStatus: 1, propertyRank: -1 });

export default PropertySchema;
