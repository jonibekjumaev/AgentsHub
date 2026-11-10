import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
	ArticleFacets,
	ArticleWriter,
	BoardArticle,
	BoardArticles,
	CommunityStats,
} from '../../libs/dto/board-article/board-article';
import { Model, PipelineStage } from 'mongoose';
import { MemberService } from '../member/member.service';
import type { ObjectId, StatisticModifier, T } from '../../libs/types/common';
import {
	AllBoardArticlesInquiry,
	BAISearch,
	BoardArticleInput,
	BoardArticlesInquiry,
} from '../../libs/dto/board-article/board-article.input';
import { Direction, Message } from '../../libs/enums/common.enum';
import { BoardArticleCategory, BoardArticleStatus } from '../../libs/enums/board-article.enum';
import { ViewInput } from '../../libs/dto/view/view.input';
import { ViewGroup } from '../../libs/enums/view.enum';
import { ViewService } from '../view/view.service';
import { BoardArticleUpdate } from '../../libs/dto/board-article/board-article.update';
import {
	communityTopWritersLimit,
	escapeRegex,
	excludeMemberSecrets,
	lookupAuthMemberLiked,
	lookupMember,
	shapeInToMongoObjectId,
	unwindKeepingItem,
} from '../../libs/config';
import { describeDbError } from '../../libs/utils';
import { LikeInput } from '../../libs/dto/like/like.input';
import { LikeGroup } from '../../libs/enums/like.enum';
import { LikeService, withMeLiked } from '../like/like.service';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';

type FacetRow = { _id: BoardArticleCategory; count: number };

@Injectable()
export class BoardArticleService {
	constructor(
		@InjectModel('BoardArticle') private readonly boardArticleModel: Model<BoardArticle>,
		private readonly memberService: MemberService,
		private readonly viewService: ViewService,
		private readonly likeService: LikeService,
	) {}

	public async createBoardArticle(memberId: ObjectId, input: BoardArticleInput): Promise<BoardArticle> {
		try {
			input.memberId = memberId;
			const result = await this.boardArticleModel.create(input);

			await this.memberService.memberStatsEditor({
				_id: memberId,
				targetKey: 'memberArticles',
				modifier: 1,
			});

			return result;
		} catch (err) {
			console.log('Error: Service.model', describeDbError(err));
			throw new InternalServerErrorException(Message.CREATE_FAILED);
		}
	}

	public async getBoardArticle(
		memberId: ObjectId,
		articleId: ObjectId,
		viewerType: MemberType | null = null,
	): Promise<BoardArticle> {
		const search = {
			_id: articleId,
			articleStatus: BoardArticleStatus.ACTIVE,
		};

		const targetBoardArticle = await this.boardArticleModel.findOne(search).lean().exec();
		if (!targetBoardArticle) throw new NotFoundException(Message.NO_DATA_FOUND);

		if (memberId) {
			const viewInput: ViewInput = { memberId: memberId, viewRefId: articleId, viewGroup: ViewGroup.ARTICLE };
			const newView = await this.viewService.recordView(viewInput, viewerType); // admins' views never count (D-42)
			if (newView) {
				await this.boardArticleStatsEditor({ _id: articleId, targetKey: 'articleViews', modifier: 1 });
				targetBoardArticle.articleViews++;
			}

			//meliked
			const likeInput: LikeInput = { memberId: memberId, likeRefId: articleId, likeGroup: LikeGroup.ARTICLE };
			targetBoardArticle.meLiked = await this.likeService.checkLikeExistence(likeInput);
		}
		targetBoardArticle.memberData = (await this.memberService.getAuthorData(targetBoardArticle.memberId)) ?? undefined; // D-38
		return targetBoardArticle;
	}

	public async updateBoardArticle(memberId: ObjectId, input: BoardArticleUpdate): Promise<BoardArticle> {
		const search = {
			_id: input._id,
			memberId: memberId,
			articleStatus: BoardArticleStatus.ACTIVE,
		};

		const result = await this.boardArticleModel.findOneAndUpdate(search, input, { new: true }).exec();
		if (!result) throw new NotFoundException(Message.UPDATE_FAILED);

		if (result?.articleStatus === BoardArticleStatus.DELETE) {
			await this.memberService.memberStatsEditor({
				_id: memberId,
				targetKey: 'memberArticles',
				modifier: -1,
			});
		}

		return result;
	}

	public async getBoardArticles(memberId: ObjectId, input: BoardArticlesInquiry): Promise<BoardArticles> {
		const match = await this.articleSearchMatch(input.search);
		if (input.search.articleCategory) match.articleCategory = input.search.articleCategory;
		// D-46: the newest _id breaks ties, so a page never repeats or skips an article (many have 0 likes or comments)
		const direction = input?.direction ?? Direction.DESC;
		const sort: Record<string, 1 | -1> = { [input?.sort ?? 'createdAt']: direction, _id: Direction.DESC };

		const result = await this.boardArticleModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							//meliked
							lookupAuthMemberLiked(memberId),
							lookupMember,
							unwindKeepingItem('$memberData'),
						],

						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0] as BoardArticles;
	}

	/**
	 * D-46: live counts for the /community topic bar, with the same rules as getBoardArticles. The topic counts ignore
	 * `articleCategory` itself (D-43 rule), and `all` is the "All" option: the same articles, every topic.
	 */
	public async getArticleFacets(search: BAISearch): Promise<ArticleFacets> {
		const match = await this.articleSearchMatch(search);
		const result = await this.boardArticleModel
			.aggregate<{ categories: FacetRow[] }>([
				{ $match: match },
				{ $facet: { categories: [{ $group: { _id: '$articleCategory', count: { $sum: 1 } } }] } },
			])
			.exec();
		const rows = result[0]?.categories ?? [];

		const categories = Object.values(BoardArticleCategory).map((value) => ({
			value,
			count: rows.find((row) => row._id === value)?.count ?? 0,
		}));
		// an article has one topic, so "All" is the sum (unlike creators, D-45)
		return { categories, all: categories.reduce((sum, facet) => sum + facet.count, 0) };
	}

	/**
	 * D-46: the /community hero and "Active writers", site-wide. `articles` counts every ACTIVE article (what the
	 * feed lists, D-38 keeps a deleted or blocked author's articles listed). Writers are ACTIVE members only: a
	 * blocked or deleted member is not promoted. Ranked by the likes on their articles, then the number of
	 * articles, then the newest article.
	 */
	public async getCommunityStats(): Promise<CommunityStats> {
		const writerStages: PipelineStage.FacetPipelineStage[] = [
			{
				$group: {
					_id: '$memberId',
					articles: { $sum: 1 },
					likes: { $sum: '$articleLikes' },
					latestAt: { $max: '$createdAt' },
				},
			},
			{
				$lookup: {
					from: 'members',
					localField: '_id',
					foreignField: '_id',
					pipeline: [{ $match: { memberStatus: MemberStatus.ACTIVE } }, excludeMemberSecrets],
					as: 'memberData',
				},
			},
			// a plain $unwind on purpose: writers who are not ACTIVE drop out
			{ $unwind: '$memberData' },
		];

		const result = await this.boardArticleModel
			.aggregate<{ articles: { n: number }[]; writers: { n: number }[]; topWriters: ArticleWriter[] }>([
				{ $match: { articleStatus: BoardArticleStatus.ACTIVE } },
				{
					$facet: {
						articles: [{ $count: 'n' }],
						writers: [...writerStages, { $count: 'n' }],
						topWriters: [
							...writerStages,
							{ $sort: { likes: -1, articles: -1, latestAt: -1 } },
							{ $limit: communityTopWritersLimit },
							{ $project: { _id: 0, memberData: 1, articles: 1, likes: 1 } },
						],
					},
				},
			])
			.exec();
		const stats = result[0];
		return {
			articles: stats?.articles[0]?.n ?? 0,
			writers: stats?.writers[0]?.n ?? 0,
			topWriters: stats?.topWriters ?? [],
		};
	}

	public async likeTargetBoardArticle(memberId: ObjectId, likeRefId: ObjectId): Promise<BoardArticle> {
		const target = await this.boardArticleModel
			.findOne({ _id: likeRefId, articleStatus: BoardArticleStatus.ACTIVE })
			.exec();
		if (!target) throw new NotFoundException(Message.NO_DATA_FOUND);

		const input: LikeInput = {
			memberId: memberId,
			likeRefId: likeRefId,
			likeGroup: LikeGroup.ARTICLE,
		};

		//LIKE TOGGLE
		const modifier: number = await this.likeService.toggleLike(input);
		const result = await this.boardArticleStatsEditor({
			_id: likeRefId,
			targetKey: 'articleLikes',
			modifier: modifier,
		});

		if (!result) throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);
		return withMeLiked(result, input, modifier);
	}

	public async getAllBoardArticlesByAdmin(input: AllBoardArticlesInquiry): Promise<BoardArticles> {
		const { articleStatus, articleCategory } = input.search;
		const match: T = {};
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };
		if (articleStatus) match.articleStatus = articleStatus;
		if (articleCategory) match.articleCategory = articleCategory;
		const result = await this.boardArticleModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							lookupMember,
							unwindKeepingItem('$memberData'),
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0] as BoardArticles;
	}

	public async updateBoardArticleByAdmin(input: BoardArticleUpdate): Promise<BoardArticle> {
		const { _id, articleStatus } = input;
		const result = await this.boardArticleModel
			.findOneAndUpdate({ _id: _id, articleStatus: BoardArticleStatus.ACTIVE }, input, {
				new: true,
			})
			.exec();
		if (!result) throw new NotFoundException(Message.UPDATE_FAILED);
		if (articleStatus === BoardArticleStatus.DELETE) {
			await this.memberService.memberStatsEditor({
				_id: result.memberId,
				targetKey: 'memberArticles',
				modifier: -1,
			});
		}
		return result;
	}

	public async removeBoardArticleByAdmin(articleId: ObjectId): Promise<BoardArticle> {
		// only soft-deleted articles, same rule as removeProductByAdmin; memberArticles was already decremented
		// when the article was set to DELETE (D-28)
		const search = {
			_id: articleId,
			articleStatus: BoardArticleStatus.DELETE,
		};

		const result = await this.boardArticleModel.findOneAndDelete(search).exec();
		if (!result) throw new NotFoundException(Message.REMOVE_FAILED);

		return result;
	}

	public async boardArticleStatsEditor(input: StatisticModifier): Promise<BoardArticle> {
		const { _id, targetKey, modifier } = input;

		const result = await this.boardArticleModel
			.findByIdAndUpdate(_id, { $inc: { [targetKey]: modifier } }, { new: true })
			.exec();
		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
		return result;
	}

	/**
	 * Visibility of one board article, the same rule as getBoardArticle: ACTIVE for everyone, DELETE for nobody
	 * (admins see deleted articles only in getAllBoardArticlesByAdmin). Child records (e.g. comments) follow it (D-16 principle).
	 */
	public isBoardArticleVisible(article: Pick<BoardArticle, 'articleStatus'>): boolean {
		return article.articleStatus === BoardArticleStatus.ACTIVE;
	}

	/**
	 * The public article filters every group shares: ACTIVE, the author's profile (`memberId`) and the text search.
	 * D-46: the text matches the title, the content, or the author's nick / full name (S8: escaped regex).
	 * `articleCategory` is left to the caller, so the topic counts can ignore it.
	 */
	private async articleSearchMatch(search: BAISearch): Promise<T> {
		const match: T = { articleStatus: BoardArticleStatus.ACTIVE };
		if (search.memberId) match.memberId = shapeInToMongoObjectId(search.memberId);

		const text = search.text?.trim();
		if (text) {
			const pattern = new RegExp(escapeRegex(text), 'i');
			const authorIds = await this.memberService.findMemberIdsByName(text);
			match.$or = [
				{ articleTitle: pattern },
				{ articleContent: pattern },
				...(authorIds.length ? [{ memberId: { $in: authorIds } }] : []),
			];
		}
		return match;
	}
}
