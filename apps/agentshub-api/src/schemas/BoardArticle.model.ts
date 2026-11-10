import { Schema } from 'mongoose';
import { BoardArticleCategory, BoardArticleStatus } from '../libs/enums/board-article.enum';

const BoardArticleSchema = new Schema(
	{
		articleCategory: {
			type: String,
			enum: BoardArticleCategory,
			required: true,
		},

		articleStatus: {
			type: String,
			enum: BoardArticleStatus,
			default: BoardArticleStatus.ACTIVE,
		},

		articleTitle: {
			type: String,
			required: true,
		},

		articleContent: {
			type: String,
			required: true,
		},

		articleImage: {
			type: String,
		},

		articleLikes: {
			type: Number,
			default: 0,
		},

		articleViews: {
			type: Number,
			default: 0,
		},

		articleComments: {
			type: Number,
			default: 0,
		},

		memberId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},
	},
	{ timestamps: true, collection: 'boardArticles' },
);

// D-46: the public board (ACTIVE, optional topic, newest first) and a member's profile list
BoardArticleSchema.index({ articleStatus: 1, articleCategory: 1, createdAt: -1 });
BoardArticleSchema.index({ memberId: 1, articleStatus: 1 });

export default BoardArticleSchema;
