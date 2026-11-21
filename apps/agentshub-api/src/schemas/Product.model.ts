import { Schema } from 'mongoose';
import { EmbeddingStatus } from '../libs/enums/embedding.enum';
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

		// 1, 2, 3… among ranked ACTIVE products, written by the nightly batch; missing = not ranked (Step 13a item 5)
		productRankPosition: {
			type: Number,
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
	{ timestamps: true, collection: 'products' },
);

ProductSchema.index({ memberId: 1, productTitle: 1 }, { unique: true });
ProductSchema.index({ memberId: 1, productStatus: 1 });
ProductSchema.index({ productCategory: 1, productStatus: 1 });
ProductSchema.index({ productStatus: 1, productRank: -1 });
// D-52: the reconcile job's lookup of documents without a current vector
ProductSchema.index({ embeddingStatus: 1 });
// D-53: the keyword half of the hybrid search ($text). A collection can have one text index; a title word weighs most
ProductSchema.index(
	{ productTitle: 'text', productTags: 'text', productDesc: 'text' },
	{ name: 'product_text', weights: { productTitle: 10, productTags: 5, productDesc: 1 } },
);

export default ProductSchema;
