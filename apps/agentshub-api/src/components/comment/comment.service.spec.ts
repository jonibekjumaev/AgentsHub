import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { expectHttpError } from '../../../test/utils/http-error';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { CommentInput, CommentsInquiry } from '../../libs/dto/comment/comment.input';
import { CommentUpdate } from '../../libs/dto/comment/comment.update';
import { BoardArticleStatus } from '../../libs/enums/board-article.enum';
import { BriefStatus } from '../../libs/enums/brief.enum';
import { CommentGroup, CommentStatus } from '../../libs/enums/comment.enum';
import { Message } from '../../libs/enums/common.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { ProductStatus } from '../../libs/enums/product.enum';
import { ObjectId, StatisticModifier } from '../../libs/types/common';
import { BoardArticleService } from '../board-article/board-article.service';
import { BriefService } from '../brief/brief.service';
import { MemberService } from '../member/member.service';
import { ProductService } from '../product/product.service';
import { CommentService } from './comment.service';

const authorId = new Types.ObjectId();
const ownerId = new Types.ObjectId();
const adminId = new Types.ObjectId();
const targetId = new Types.ObjectId();
const commentId = new Types.ObjectId();

// the real visibility methods, on instances built without their dependencies (the methods use none)
const real = {
	product: Object.create(ProductService.prototype) as ProductService,
	brief: Object.create(BriefService.prototype) as BriefService,
	boardArticle: Object.create(BoardArticleService.prototype) as BoardArticleService,
	member: Object.create(MemberService.prototype) as MemberService,
};

type StatsEditor = jest.Mock<Promise<unknown>, [StatisticModifier]>;
const statsEditor = (): StatsEditor => jest.fn<Promise<unknown>, [StatisticModifier]>().mockResolvedValue({});

describe('CommentService', () => {
	let service: CommentService;
	let models: Record<'comment' | 'product' | 'brief' | 'boardArticle' | 'member', MockModel>;
	let editors: Record<CommentGroup, StatsEditor>;

	beforeEach(async () => {
		models = {
			comment: createMockModel(),
			product: createMockModel(),
			brief: createMockModel(),
			boardArticle: createMockModel(),
			member: createMockModel(),
		};
		editors = {
			[CommentGroup.PRODUCT]: statsEditor(),
			[CommentGroup.BRIEF]: statsEditor(),
			[CommentGroup.ARTICLE]: statsEditor(),
			[CommentGroup.MEMBER]: statsEditor(),
		};

		// the visibility checks are the services' real methods: getComments must follow the real D-16 / D-30 rules
		const moduleRef = await Test.createTestingModule({
			providers: [
				CommentService,
				{ provide: getModelToken('Comment'), useValue: models.comment },
				{ provide: getModelToken('Product'), useValue: models.product },
				{ provide: getModelToken('Brief'), useValue: models.brief },
				{ provide: getModelToken('BoardArticle'), useValue: models.boardArticle },
				{ provide: getModelToken('Member'), useValue: models.member },
				{
					provide: ProductService,
					useValue: {
						productStatsEditor: editors[CommentGroup.PRODUCT],
						isProductVisible: (...args: Parameters<ProductService['isProductVisible']>) =>
							real.product.isProductVisible(...args),
					},
				},
				{
					provide: BriefService,
					useValue: {
						briefStatsEditor: editors[CommentGroup.BRIEF],
						isBriefVisible: (...args: Parameters<BriefService['isBriefVisible']>) => real.brief.isBriefVisible(...args),
					},
				},
				{
					provide: BoardArticleService,
					useValue: {
						boardArticleStatsEditor: editors[CommentGroup.ARTICLE],
						isBoardArticleVisible: (...args: Parameters<BoardArticleService['isBoardArticleVisible']>) =>
							real.boardArticle.isBoardArticleVisible(...args),
					},
				},
				{
					provide: MemberService,
					useValue: {
						memberStatsEditor: editors[CommentGroup.MEMBER],
						isMemberVisible: (...args: Parameters<MemberService['isMemberVisible']>) =>
							real.member.isMemberVisible(...args),
					},
				},
			],
		}).compile();
		service = moduleRef.get(CommentService);
	});

	/** The target model of each group and the filter a new comment needs (B7, D-16, D-30) */
	const targets: Array<[CommentGroup, keyof typeof models, Record<string, unknown>, string]> = [
		[CommentGroup.PRODUCT, 'product', { productStatus: ProductStatus.ACTIVE }, 'productComments'],
		[CommentGroup.BRIEF, 'brief', { briefStatus: BriefStatus.OPEN }, 'briefComments'],
		[CommentGroup.ARTICLE, 'boardArticle', { articleStatus: BoardArticleStatus.ACTIVE }, 'articleComments'],
		[CommentGroup.MEMBER, 'member', { memberStatus: MemberStatus.ACTIVE }, 'memberComments'],
	];
	const allEditorCalls = () => Object.values(editors).flatMap((editor) => editor.mock.calls);

	describe('createComment', () => {
		// the resolver passes commentRefId as the client sent it: a string
		const commentInput = (commentGroup: CommentGroup, commentRefId: string = targetId.toHexString()): CommentInput => ({
			commentGroup,
			commentRefId: commentRefId as unknown as ObjectId,
			commentContent: 'Nice!',
		});

		beforeEach(() => {
			models.comment.create.mockImplementation((input: CommentInput) => Promise.resolve({ _id: commentId, ...input }));
		});

		it.each(targets)(
			'%s: checks the target with %s, then adds 1 to its counter (B6, B7)',
			async (group, model, activeFilter, targetKey) => {
				models[model].resolve('exists', { _id: targetId });
				await service.createComment(authorId, commentInput(group));

				expect(models[model].exists).toHaveBeenCalledWith({ _id: targetId.toHexString(), ...activeFilter });
				expect(models.comment.create).toHaveBeenCalledWith(expect.objectContaining({ memberId: authorId }));
				// for MEMBER, the member commented on gets +1, not the author (B6)
				expect(editors[group]).toHaveBeenCalledWith({ _id: targetId.toHexString(), targetKey, modifier: 1 });
				expect(allEditorCalls()).toHaveLength(1);
			},
		);

		it.each(targets)('%s: a missing or inactive target → NOT_FOUND, no comment, no counter (B7)', async (group) => {
			await expectHttpError(
				service.createComment(authorId, commentInput(group)),
				NotFoundException,
				Message.NO_DATA_FOUND,
			);
			expect(models.comment.create).not.toHaveBeenCalled();
			expect(allEditorCalls()).toEqual([]);
		});

		it('a malformed commentRefId → BAD_REQUEST, without a database query', async () => {
			await expectHttpError(
				service.createComment(authorId, commentInput(CommentGroup.PRODUCT, 'abc')),
				BadRequestException,
				Message.NO_DATA_FOUND,
			);
			expect(models.product.exists).not.toHaveBeenCalled();
		});

		it('a database error on create → CREATE_FAILED, no counter', async () => {
			models.product.resolve('exists', { _id: targetId });
			models.comment.create.mockRejectedValue(new Error('connection lost'));

			await expectHttpError(
				service.createComment(authorId, commentInput(CommentGroup.PRODUCT)),
				InternalServerErrorException,
				Message.CREATE_FAILED,
			);
			expect(allEditorCalls()).toEqual([]);
		});
	});

	describe('deleting a comment lowers the counter exactly once (B19)', () => {
		const storedComment = (group: CommentGroup, commentStatus: CommentStatus) => ({
			_id: commentId,
			memberId: authorId,
			commentGroup: group,
			commentRefId: targetId,
			commentStatus,
		});

		describe('updateComment (owner)', () => {
			const update = (fields: Partial<CommentUpdate>) => ({ _id: commentId, ...fields });

			it("is pinned to the author's ACTIVE comment (compare-and-set)", async () => {
				models.comment.resolve('findOneAndUpdate', storedComment(CommentGroup.PRODUCT, CommentStatus.ACTIVE));
				await service.updateComment(authorId, update({ commentContent: 'Edited' }));

				expect(models.comment.findOneAndUpdate).toHaveBeenCalledWith(
					{ _id: commentId, memberId: authorId, commentStatus: CommentStatus.ACTIVE },
					update({ commentContent: 'Edited' }),
					{ new: true },
				);
				expect(allEditorCalls()).toEqual([]);
			});

			it.each(targets)('%s: ACTIVE → DELETE subtracts 1 from the target', async (group, model, _filter, targetKey) => {
				models.comment.resolve('findOneAndUpdate', storedComment(group, CommentStatus.DELETE));
				models[model].resolve('exists', { _id: targetId });
				await service.updateComment(authorId, update({ commentStatus: CommentStatus.DELETE }));

				expect(editors[group]).toHaveBeenCalledWith({ _id: targetId, targetKey, modifier: -1 });
				expect(allEditorCalls()).toHaveLength(1);
			});

			it('a second DELETE, or a foreign or missing comment → NOT_FOUND UPDATE_FAILED, no counter change', async () => {
				await expectHttpError(
					service.updateComment(authorId, update({ commentStatus: CommentStatus.DELETE })),
					NotFoundException,
					Message.UPDATE_FAILED,
				);
				expect(allEditorCalls()).toEqual([]);
			});

			it('a target already hard-deleted by an admin: the delete works, no counter left to change', async () => {
				models.comment.resolve('findOneAndUpdate', storedComment(CommentGroup.PRODUCT, CommentStatus.DELETE));
				await service.updateComment(authorId, update({ commentStatus: CommentStatus.DELETE }));

				expect(allEditorCalls()).toEqual([]);
			});
		});

		describe('removeCommentByAdmin', () => {
			it.each(targets)('%s: removing an ACTIVE comment subtracts 1', async (group, model, _filter, targetKey) => {
				models.comment.resolve('findOneAndDelete', storedComment(group, CommentStatus.ACTIVE));
				models[model].resolve('exists', { _id: targetId });
				await service.removeCommentByAdmin(commentId);

				expect(models.comment.findOneAndDelete).toHaveBeenCalledWith({ _id: commentId });
				expect(editors[group]).toHaveBeenCalledWith({ _id: targetId, targetKey, modifier: -1 });
				expect(allEditorCalls()).toHaveLength(1);
			});

			it('removing a comment already set to DELETE changes no counter (it was subtracted then)', async () => {
				models.comment.resolve('findOneAndDelete', storedComment(CommentGroup.BRIEF, CommentStatus.DELETE));
				await service.removeCommentByAdmin(commentId);

				expect(models.brief.exists).not.toHaveBeenCalled();
				expect(allEditorCalls()).toEqual([]);
			});

			it('a missing comment → NOT_FOUND REMOVE_FAILED', async () => {
				await expectHttpError(service.removeCommentByAdmin(commentId), NotFoundException, Message.REMOVE_FAILED);
			});
		});
	});

	describe('getComments follows the target visibility (D-16 principle)', () => {
		const inquiry = (commentGroup: CommentGroup): CommentsInquiry => ({
			page: 1,
			limit: 10,
			search: { commentRefId: targetId, commentGroup },
		});
		const viewers: Record<string, [ObjectId | null, MemberType | null]> = {
			guest: [null, null],
			other: [authorId, MemberType.USER],
			owner: [ownerId, MemberType.CREATOR],
			admin: [adminId, MemberType.ADMIN],
		};

		beforeEach(() => {
			models.comment.resolve('aggregate', [{ list: [], metaCounter: [] }]);
		});

		it.each([
			// [group, target model, stored target, viewer, visible]
			[CommentGroup.PRODUCT, 'product', { productStatus: ProductStatus.ACTIVE }, 'guest', true],
			[CommentGroup.PRODUCT, 'product', { productStatus: ProductStatus.PAUSED }, 'guest', false],
			[CommentGroup.PRODUCT, 'product', { productStatus: ProductStatus.PAUSED }, 'other', false],
			[CommentGroup.PRODUCT, 'product', { productStatus: ProductStatus.PAUSED }, 'owner', true],
			[CommentGroup.PRODUCT, 'product', { productStatus: ProductStatus.PAUSED }, 'admin', true],
			[CommentGroup.PRODUCT, 'product', { productStatus: ProductStatus.DELETE }, 'admin', false],
			[CommentGroup.BRIEF, 'brief', { briefStatus: BriefStatus.OPEN }, 'guest', true],
			[CommentGroup.BRIEF, 'brief', { briefStatus: BriefStatus.CLOSED }, 'guest', true],
			[CommentGroup.BRIEF, 'brief', { briefStatus: BriefStatus.DELETE }, 'admin', false],
			[CommentGroup.ARTICLE, 'boardArticle', { articleStatus: BoardArticleStatus.ACTIVE }, 'guest', true],
			[CommentGroup.ARTICLE, 'boardArticle', { articleStatus: BoardArticleStatus.DELETE }, 'guest', false],
			[CommentGroup.MEMBER, 'member', { memberStatus: MemberStatus.BLOCK }, 'guest', true],
			[CommentGroup.MEMBER, 'member', { memberStatus: MemberStatus.DELETE }, 'guest', false],
		] as const)('%s target %s %j, viewer %s → visible: %p', async (group, model, stored, viewer, visible) => {
			models[model].resolve('findById', { _id: targetId, memberId: ownerId, ...stored });
			const [memberId, memberType] = viewers[viewer];
			const result = service.getComments(memberId, memberType, inquiry(group));

			if (visible) {
				await expect(result).resolves.toEqual({ list: [], metaCounter: [] });
				expect(models.comment.aggregate.mock.calls[0][0]).toContainEqual({
					$match: { commentRefId: targetId, commentGroup: group, commentStatus: CommentStatus.ACTIVE },
				});
			} else {
				await expectHttpError(result, NotFoundException, Message.NO_DATA_FOUND);
				expect(models.comment.aggregate).not.toHaveBeenCalled();
			}
		});

		it.each(targets)('%s: a missing target → NOT_FOUND, like a hidden one', async (group) => {
			await expectHttpError(service.getComments(null, null, inquiry(group)), NotFoundException, Message.NO_DATA_FOUND);
		});
	});
});
