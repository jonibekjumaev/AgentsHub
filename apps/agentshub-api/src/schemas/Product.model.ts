import { Schema } from 'mongoose';
import { ProductStatus } from '../libs/enums/product.enum';

const ProductSchema = new Schema(
	{
		productStatus: {
			type: String,
			enum: ProductStatus,
			default: ProductStatus.ACTIVE,
		},

		productTitle: {
			type: String,
			required: true,
		},

		productPrice: {
			type: Number,
			required: true,
		},

		productViews: {
			type: Number,
			default: 0,
		},

		productLikes: {
			type: Number,
			default: 0,
		},

		productComments: {
			type: Number,
			default: 0,
		},

		productRank: {
			type: Number,
			default: 0,
		},

		productImages: {
			type: [String],
			required: true,
		},

		productDesc: {
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
	{ timestamps: true, collection: 'products' },
);

ProductSchema.index({ memberId: 1, productTitle: 1 }, { unique: true });
ProductSchema.index({ memberId: 1, productStatus: 1 });
ProductSchema.index({ productStatus: 1, productRank: -1 });

export default ProductSchema;
