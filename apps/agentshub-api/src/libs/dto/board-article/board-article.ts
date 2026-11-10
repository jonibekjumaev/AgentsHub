import { Field, Int, ObjectType } from '@nestjs/graphql';
import { BoardArticleCategory, BoardArticleStatus } from '../../enums/board-article.enum';
import type { ObjectId } from '../../types/common';
import { Member, TotalCounter } from '../member/member';
import { MeLiked } from '../like/like';

@ObjectType()
export class BoardArticle {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => BoardArticleCategory)
	articleCategory!: BoardArticleCategory;

	@Field(() => BoardArticleStatus)
	articleStatus!: BoardArticleStatus;

	@Field(() => String)
	articleTitle!: string;

	@Field(() => String)
	articleContent!: string;

	@Field(() => String, { nullable: true })
	articleImage?: string;

	@Field(() => Int)
	articleViews!: number;

	@Field(() => Int)
	articleLikes!: number;

	@Field(() => Int)
	articleComments!: number;

	@Field(() => String)
	memberId!: ObjectId;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;

	/** from aggregation **/

	@Field(() => [MeLiked], { nullable: true })
	meLiked?: MeLiked[];

	@Field(() => Member, { nullable: true })
	memberData?: Member;
}

@ObjectType()
export class BoardArticles {
	@Field(() => [BoardArticle])
	list!: BoardArticle[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter!: TotalCounter[];
}

/** D-46: the number of ACTIVE articles in one topic, for the /community topic bar. */
@ObjectType()
export class ArticleCategoryFacet {
	@Field(() => BoardArticleCategory)
	value!: BoardArticleCategory;

	@Field(() => Int)
	count!: number;
}

/** D-46: live counts for the /community topic bar; the same search as getBoardArticles. */
@ObjectType()
export class ArticleFacets {
	/** Every topic in enum order, 0 when nothing matches; each count ignores `articleCategory` itself */
	@Field(() => [ArticleCategoryFacet])
	categories!: ArticleCategoryFacet[];

	/** The "All" option: every filter but `articleCategory` */
	@Field(() => Int)
	all!: number;
}

/** D-46: one author in the "Active writers" sidebar. */
@ObjectType()
export class ArticleWriter {
	@Field(() => Member)
	memberData!: Member;

	/** Their ACTIVE articles */
	@Field(() => Int)
	articles!: number;

	/** The likes on those articles */
	@Field(() => Int)
	likes!: number;
}

/** D-46: the /community hero and sidebar, site-wide (no filters). */
@ObjectType()
export class CommunityStats {
	/** ACTIVE articles (the number the feed lists with no filter) */
	@Field(() => Int)
	articles!: number;

	/** ACTIVE members with at least one ACTIVE article */
	@Field(() => Int)
	writers!: number;

	/** The most liked of those writers, best first */
	@Field(() => [ArticleWriter])
	topWriters!: ArticleWriter[];
}
