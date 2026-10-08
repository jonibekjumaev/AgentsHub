import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { MemberService } from '../member/member.service';
import { isValidObjectId, Model } from 'mongoose';
import { ObjectId, T } from '../../libs/types/common';
import { CommentInput, CommentsInquiry } from '../../libs/dto/comment/comment.input';
import { Comment, Comments } from '../../libs/dto/comment/comment';
import { Direction, Message } from '../../libs/enums/common.enum';
import { CommentGroup, CommentStatus } from '../../libs/enums/comment.enum';
import { ProductService } from '../product/product.service';
import { BriefService } from '../brief/brief.service';
import { BoardArticleService } from '../board-article/board-article.service';
import { CommentUpdate } from '../../libs/dto/comment/comment.update';
import { lookupMember } from '../../libs/config';
import { describeDbError } from '../../libs/utils';
import { Product } from '../../libs/dto/product/product';
import { Brief } from '../../libs/dto/brief/brief';
import { BoardArticle } from '../../libs/dto/board-article/board-article';
import { Member } from '../../libs/dto/member/member';
import { ProductStatus } from '../../libs/enums/product.enum';
import { BriefStatus } from '../../libs/enums/brief.enum';
import { BoardArticleStatus } from '../../libs/enums/board-article.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';

@Injectable()
export class CommentService {
	constructor(
		@InjectModel('Comment') private readonly commentModel: Model<Comment>,
		@InjectModel('Product') private readonly productModel: Model<Product>,
		@InjectModel('Brief') private readonly briefModel: Model<Brief>,
		@InjectModel('BoardArticle') private readonly boardArticleModel: Model<BoardArticle>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		private readonly memberService: MemberService,
		private readonly productService: ProductService,
		private readonly briefService: BriefService,
		private readonly boardArticleService: BoardArticleService,
	) {}

	public async createComment(memberId: ObjectId, input: CommentInput): Promise<Comment> {
		input.memberId = memberId;
		await this.checkCommentTarget(input);
		let result: Comment;
		try {
			result = await this.commentModel.create(input);
		} catch (err) {
			console.log('Error: Service.model', describeDbError(err));
			throw new InternalServerErrorException(Message.CREATE_FAILED);
		}

		await this.targetCommentsEditor(input.commentGroup, input.commentRefId, 1);
		return result;
	}

	/** The target's *Comments counter, only through its stats editor (ER rule 5). */
	private async targetCommentsEditor(
		commentGroup: CommentGroup,
		commentRefId: ObjectId,
		modifier: number,
	): Promise<void> {
		switch (commentGroup) {
			case CommentGroup.PRODUCT:
				await this.productService.productStatsEditor({
					_id: commentRefId,
					targetKey: 'productComments',
					modifier: modifier,
				});
				break;
			case CommentGroup.BRIEF:
				await this.briefService.briefStatsEditor({
					_id: commentRefId,
					targetKey: 'briefComments',
					modifier: modifier,
				});
				break;
			case CommentGroup.ARTICLE:
				await this.boardArticleService.boardArticleStatsEditor({
					_id: commentRefId,
					targetKey: 'articleComments',
					modifier: modifier,
				});
				break;
			case CommentGroup.MEMBER:
				await this.memberService.memberStatsEditor({
					_id: commentRefId,
					targetKey: 'memberComments',
					modifier: modifier,
				});
				break;
		}
	}

	/**
	 * B19: called once per comment that leaves ACTIVE (owner DELETE or admin remove), so the counter drops exactly once.
	 * A target already hard-deleted by an admin has no counter left to fix.
	 */
	private async onCommentDeleted(comment: Pick<Comment, 'commentGroup' | 'commentRefId'>): Promise<void> {
		const { commentGroup, commentRefId } = comment;
		let exist: T | null = null;
		switch (commentGroup) {
			case CommentGroup.PRODUCT:
				exist = await this.productModel.exists({ _id: commentRefId }).exec();
				break;
			case CommentGroup.BRIEF:
				exist = await this.briefModel.exists({ _id: commentRefId }).exec();
				break;
			case CommentGroup.ARTICLE:
				exist = await this.boardArticleModel.exists({ _id: commentRefId }).exec();
				break;
			case CommentGroup.MEMBER:
				exist = await this.memberModel.exists({ _id: commentRefId }).exec();
				break;
		}
		if (exist) await this.targetCommentsEditor(commentGroup, commentRefId, -1);
	}

	private async checkCommentTarget(input: CommentInput): Promise<void> {
		const { commentGroup, commentRefId } = input;
		if (!isValidObjectId(commentRefId)) throw new BadRequestException(Message.NO_DATA_FOUND);

		let exist: T | null = null;
		switch (commentGroup) {
			case CommentGroup.PRODUCT:
				exist = await this.productModel.exists({ _id: commentRefId, productStatus: ProductStatus.ACTIVE }).exec();
				break;
			case CommentGroup.BRIEF:
				// new comments only on an OPEN brief; a CLOSED brief keeps its comments readable (D-30)
				exist = await this.briefModel.exists({ _id: commentRefId, briefStatus: BriefStatus.OPEN }).exec();
				break;
			case CommentGroup.ARTICLE:
				exist = await this.boardArticleModel
					.exists({ _id: commentRefId, articleStatus: BoardArticleStatus.ACTIVE })
					.exec();
				break;
			case CommentGroup.MEMBER:
				exist = await this.memberModel.exists({ _id: commentRefId, memberStatus: MemberStatus.ACTIVE }).exec();
				break;
		}
		if (!exist) throw new NotFoundException(Message.NO_DATA_FOUND);
	}

	public async updateComment(memberId: ObjectId, input: CommentUpdate): Promise<Comment> {
		const { _id } = input;
		// compare-and-set (D-29 pattern): only an ACTIVE comment matches, so a concurrent second DELETE finds nothing
		const result = await this.commentModel
			.findOneAndUpdate(
				{
					_id: _id,
					memberId: memberId,
					commentStatus: CommentStatus.ACTIVE,
				},
				input,
				{
					new: true,
				},
			)
			.exec();
		if (!result) throw new NotFoundException(Message.UPDATE_FAILED);

		// this write moved the comment from ACTIVE to DELETE (B19)
		if (result.commentStatus === CommentStatus.DELETE) await this.onCommentDeleted(result);
		return result;
	}

	public async getComments(
		memberId: ObjectId | null,
		memberType: MemberType | null,
		input: CommentsInquiry,
	): Promise<Comments> {
		const { commentRefId, commentGroup } = input.search;
		const isVisible = await this.isCommentTargetVisible(commentGroup, commentRefId, memberId, memberType);
		if (!isVisible) throw new NotFoundException(Message.NO_DATA_FOUND);

		const match = { commentRefId: commentRefId, commentGroup: commentGroup, commentStatus: CommentStatus.ACTIVE };
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		const result = await this.commentModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							//meliked
							lookupMember,
							{ $unwind: '$memberData' },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0] as Comments;
	}

	/**
	 * Comments follow their target's visibility (D-16 principle): a missing or hidden target answers the same way.
	 * PRODUCT: D-16, BRIEF: D-30, ARTICLE: as getBoardArticle, MEMBER: as getMember (a BLOCK member stays readable).
	 */
	private async isCommentTargetVisible(
		commentGroup: CommentGroup,
		commentRefId: ObjectId,
		memberId: ObjectId | null,
		memberType: MemberType | null,
	): Promise<boolean> {
		switch (commentGroup) {
			case CommentGroup.PRODUCT: {
				const product = await this.productModel.findById(commentRefId).select('productStatus memberId').lean().exec();
				return !!product && this.productService.isProductVisible(product, memberId, memberType);
			}
			case CommentGroup.BRIEF: {
				const brief = await this.briefModel.findById(commentRefId).select('briefStatus').lean().exec();
				return !!brief && this.briefService.isBriefVisible(brief);
			}
			case CommentGroup.ARTICLE: {
				const article = await this.boardArticleModel.findById(commentRefId).select('articleStatus').lean().exec();
				return !!article && this.boardArticleService.isBoardArticleVisible(article);
			}
			case CommentGroup.MEMBER: {
				const member = await this.memberModel.findById(commentRefId).select('memberStatus').lean().exec();
				return !!member && this.memberService.isMemberVisible(member);
			}
			default:
				return false;
		}
	}

	public async removeCommentByAdmin(input: ObjectId): Promise<Comment> {
		const result = await this.commentModel.findOneAndDelete({ _id: input }).exec();
		if (!result) throw new NotFoundException(Message.REMOVE_FAILED);

		// an ACTIVE comment still counts on its target; a DELETE one was already subtracted (B19)
		if (result.commentStatus === CommentStatus.ACTIVE) await this.onCommentDeleted(result);
		return result;
	}
}
