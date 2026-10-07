import { Schema } from 'mongoose';
import { ProductPricing, ProductStatus } from '../libs/enums/product.enum';
import { AgentCategory } from '../libs/enums/agent-category.enum';

const ProductSchema = new Schema(
	{
		productCategory: {
			type: String,
			enum: AgentCategory,
			required: true,
		},

		productStatus: {
			type: String,
			enum: ProductStatus,
			default: ProductStatus.ACTIVE,
		},

		productPricing: {
			type: String,
			enum: ProductPricing,
			required: true,
		},

		productTitle: {
			type: String,
			required: true,
		},

		// conditional on productPricing (D-03); the rule is checked in ProductService, not here
		productPrice: {
			type: Number,
		},

		productDemoUrl: {
			type: String,
		},

		productTags: {
			type: [String],
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
			required: true,
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
ProductSchema.index({ productCategory: 1, productStatus: 1 });
ProductSchema.index({ productStatus: 1, productRank: -1 });

export default ProductSchema;
