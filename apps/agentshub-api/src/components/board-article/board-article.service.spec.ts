import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { excludeMemberSecrets } from '../../libs/config';
import { BoardArticleCategory, BoardArticleStatus } from '../../libs/enums/board-article.enum';
import { Direction } from '../../libs/enums/common.enum';
import { MemberStatus } from '../../libs/enums/member.enum';
import { LikeService } from '../like/like.service';
import { MemberService } from '../member/member.service';
import { ViewService } from '../view/view.service';
import { BoardArticleService } from './board-article.service';

const { ACTIVE } = BoardArticleStatus;
const { FREE, NEWS, HUMOR } = BoardArticleCategory;

const authorId = new Types.ObjectId();
const writerId = new Types.ObjectId();

describe('BoardArticleService', () => {
	let service: BoardArticleService;
	let articleModel: MockModel;
	let memberService: { findMemberIdsByName: jest.Mock<Promise<unknown[]>, [string]> };

	beforeEach(async () => {
		articleModel = createMockModel();
		memberService = { findMemberIdsByName: jest.fn<Promise<unknown[]>, [string]>().mockResolvedValue([]) };

		const moduleRef = await Test.createTestingModule({
			providers: [
				BoardArticleService,
				{ provide: getModelToken('BoardArticle'), useValue: articleModel },
				{ provide: MemberService, useValue: memberService },
				{ provide: ViewService, useValue: {} },
				{ provide: LikeService, useValue: {} },
			],
		}).compile();
		service = moduleRef.get(BoardArticleService);
	});

	const pipeline = () => articleModel.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
	const match = () => pipeline()[0].$match as Record<string, unknown>;

	describe('getBoardArticles', () => {
		const inquiry = { page: 1, limit: 10, search: {} };

		beforeEach(() => {
			articleModel.resolve('aggregate', [{ list: [], metaCounter: [] }]);
		});

		it('lists ACTIVE articles, filtered by topic and author profile', async () => {
			await service.getBoardArticles(null as never, {
				...inquiry,
				search: { articleCategory: NEWS, memberId: authorId },
			});

			expect(match()).toEqual({ articleStatus: ACTIVE, memberId: authorId, articleCategory: NEWS });
			expect(memberService.findMemberIdsByName).not.toHaveBeenCalled();
		});

		it('D-46: the text matches the title, the content or the author, escaped (S8)', async () => {
			memberService.findMemberIdsByName.mockResolvedValue([writerId]);
			await service.getBoardArticles(null as never, { ...inquiry, search: { text: ' a+b ' } });

			expect(memberService.findMemberIdsByName).toHaveBeenCalledWith('a+b');
			expect(match()).toEqual({
				articleStatus: ACTIVE,
				$or: [{ articleTitle: /a\+b/i }, { articleContent: /a\+b/i }, { memberId: { $in: [writerId] } }],
			});
		});

		it('D-46: no author branch when no member matches, and blank text is no filter', async () => {
			await service.getBoardArticles(null as never, { ...inquiry, search: { text: 'bot' } });
			expect(match().$or).toEqual([{ articleTitle: /bot/i }, { articleContent: /bot/i }]);

			articleModel.aggregate.mockClear();
			articleModel.resolve('aggregate', [{ list: [], metaCounter: [] }]);
			await service.getBoardArticles(null as never, { ...inquiry, search: { text: '   ' } });
			expect(match()).toEqual({ articleStatus: ACTIVE });
		});

		it('D-46: sorts by the chosen field (articleComments: "most discussed"), the newest _id breaking ties', async () => {
			await service.getBoardArticles(null as never, { ...inquiry, sort: 'articleComments' });
			expect(pipeline()[1]).toEqual({ $sort: { articleComments: Direction.DESC, _id: Direction.DESC } });

			articleModel.aggregate.mockClear();
			articleModel.resolve('aggregate', [{ list: [], metaCounter: [] }]);
			await service.getBoardArticles(null as never, inquiry);
			expect(pipeline()[1]).toEqual({ $sort: { createdAt: Direction.DESC, _id: Direction.DESC } });
		});
	});

	describe('getArticleFacets (D-46)', () => {
		it('counts per topic without the topic filter itself, with the other filters', async () => {
			memberService.findMemberIdsByName.mockResolvedValue([writerId]);
			articleModel.resolve('aggregate', [{ categories: [] }]);

			await service.getArticleFacets({ articleCategory: NEWS, memberId: authorId, text: 'bot' });

			expect(pipeline()).toEqual([
				{
					$match: {
						articleStatus: ACTIVE,
						memberId: authorId,
						$or: [{ articleTitle: /bot/i }, { articleContent: /bot/i }, { memberId: { $in: [writerId] } }],
					},
				},
				{ $facet: { categories: [{ $group: { _id: '$articleCategory', count: { $sum: 1 } } }] } },
			]);
		});

		it('lists every topic in enum order, 0 when nothing matches, and "All" as their sum', async () => {
			articleModel.resolve('aggregate', [
				{
					categories: [
						{ _id: HUMOR, count: 2 },
						{ _id: FREE, count: 3 },
					],
				},
			]);

			expect(await service.getArticleFacets({})).toEqual({
				categories: [
					{ value: FREE, count: 3 },
					{ value: BoardArticleCategory.RECOMMEND, count: 0 },
					{ value: NEWS, count: 0 },
					{ value: HUMOR, count: 2 },
				],
				all: 5,
			});
		});

		it('an empty aggregation result gives all zeros', async () => {
			articleModel.resolve('aggregate', []);

			const result = await service.getArticleFacets({});

			expect(result.all).toBe(0);
			expect(result.categories.every((facet) => facet.count === 0)).toBe(true);
		});
	});

	describe('getCommunityStats (D-46)', () => {
		it('counts ACTIVE articles, and ranks ACTIVE writers by likes, then articles, then the newest article', async () => {
			articleModel.resolve('aggregate', []);
			await service.getCommunityStats();

			const writerStages = [
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
				{ $unwind: '$memberData' },
			];
			expect(pipeline()).toEqual([
				{ $match: { articleStatus: ACTIVE } },
				{
					$facet: {
						articles: [{ $count: 'n' }],
						writers: [...writerStages, { $count: 'n' }],
						topWriters: [
							...writerStages,
							{ $sort: { likes: -1, articles: -1, latestAt: -1 } },
							{ $limit: 5 },
							{ $project: { _id: 0, memberData: 1, articles: 1, likes: 1 } },
						],
					},
				},
			]);
		});

		it('maps the counts, and gives zeros and no writers on an empty site', async () => {
			const writer = { memberData: { _id: writerId, memberNick: 'nova' }, articles: 2, likes: 7 };
			articleModel.resolve('aggregate', [{ articles: [{ n: 4 }], writers: [{ n: 1 }], topWriters: [writer] }]);
			expect(await service.getCommunityStats()).toEqual({ articles: 4, writers: 1, topWriters: [writer] });

			articleModel.resolve('aggregate', [{ articles: [], writers: [], topWriters: [] }]);
			expect(await service.getCommunityStats()).toEqual({ articles: 0, writers: 0, topWriters: [] });
		});
	});
});
