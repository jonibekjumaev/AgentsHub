import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import { AgentCategory } from '../../enums/agent-category.enum';
import { MemberAuthType, MemberStatus, MemberType } from '../../enums/member.enum';
import { ProductPricing } from '../../enums/product.enum';
import type { ObjectId } from '../../types/common';
import { MeLiked } from '../like/like';
import { MeFollowed } from '../follow/follow';
import { CategoryFacet } from '../facet';

/** D-45: one agent on a creator card (public fields only). */
@ObjectType()
export class CreatorProduct {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => String)
	productTitle!: string;

	@Field(() => AgentCategory)
	productCategory!: AgentCategory;

	@Field(() => ProductPricing)
	productPricing!: ProductPricing;

	@Field(() => Float, { nullable: true })
	productPrice?: number;
}

@ObjectType()
export class Member {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => MemberType)
	memberType!: MemberType;

	@Field(() => MemberStatus)
	memberStatus!: MemberStatus;

	@Field(() => MemberAuthType)
	memberAuthType!: MemberAuthType;

	@Field(() => String)
	memberPhone!: string;

	@Field(() => String)
	memberNick!: string;

	memberPassword?: string;

	@Field(() => String, { nullable: true })
	memberFullName?: string;

	@Field(() => String)
	memberImage!: string;

	/** Guests get null; resolved only in MemberContactResolver (D-07) */
	@Field(() => String, { nullable: true })
	memberEmail?: string;

	@Field(() => String, { nullable: true })
	memberWhatsapp?: string;

	@Field(() => String, { nullable: true })
	memberDesc?: string;

	/** Only the member themself gets the value; everyone else gets null (MemberContactResolver, D-42) */
	@Field(() => Boolean, { nullable: true })
	memberBrowsePrivately?: boolean;

	@Field(() => Int)
	memberProducts!: number;

	@Field(() => Int)
	memberBriefs!: number;

	@Field(() => Int)
	memberArticles!: number;

	@Field(() => Int)
	memberFollowers!: number;

	@Field(() => Int)
	memberFollowings!: number;

	@Field(() => Int)
	memberPoints!: number;

	@Field(() => Int)
	memberLikes!: number;

	@Field(() => Int)
	memberViews!: number;

	@Field(() => Int)
	memberComments!: number;

	@Field(() => Int)
	memberRank!: number;

	/** The place among creators in the nightly ranking (1 = top); null when not ranked (Step 13a item 5) */
	@Field(() => Int, { nullable: true })
	memberRankPosition?: number;

	@Field(() => Int)
	memberWarnings!: number;

	@Field(() => Int)
	memberBlocks!: number;

	@Field(() => Date, { nullable: true })
	deletedAt?: Date;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;

	@Field(() => String, { nullable: true })
	accessToken?: string;

	/** from Aggregation */

	@Field(() => [MeLiked], { nullable: true })
	meLiked?: MeLiked[];

	@Field(() => [MeFollowed], { nullable: true })
	meFollowed?: MeFollowed[];

	/** D-45, getCreators and getCreatorStats only: the creator's ACTIVE agents (memberProducts also counts PAUSED, D-16) */
	@Field(() => Int, { nullable: true })
	memberActiveProducts?: number;

	/** D-45: the categories of the ACTIVE agents, the best-ranked agent's category first */
	@Field(() => [AgentCategory], { nullable: true })
	memberCategories?: AgentCategory[];

	/** D-45, getCreators only: the 2 best-ranked ACTIVE agents, for the creator card */
	@Field(() => [CreatorProduct], { nullable: true })
	memberTopProducts?: CreatorProduct[];
}

@ObjectType()
export class TotalCounter {
	@Field(() => Int, { nullable: true })
	total?: number;
}

@ObjectType()
export class Members {
	@Field(() => [Member])
	list!: Member[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter?: TotalCounter[];
}

/** D-45: live counts next to the /creators filters. Each group is counted without its own filter. */
@ObjectType()
export class CreatorFacets {
	/** A creator counts once in every category they have an ACTIVE agent in. */
	@Field(() => [CategoryFacet])
	categories!: CategoryFacet[];

	/** "All": the creators matching every filter but categoryList (not the sum above: one creator, many categories). */
	@Field(() => Int)
	all!: number;

	/** Creators with no ACTIVE agent that "withAgentsOnly" hides (0 when it is off). */
	@Field(() => Int)
	withoutAgents!: number;

	/** Creators the caller follows (0 for guests). */
	@Field(() => Int)
	following!: number;
}

/** D-45: the /creators hero line, site-wide: "{creators} creators, {agents} agents listed" and 5 faces. */
@ObjectType()
export class CreatorStats {
	/** ACTIVE creators */
	@Field(() => Int)
	creators!: number;

	/** ACTIVE agents of ACTIVE creators (the same number /agents counts) */
	@Field(() => Int)
	agents!: number;

	/** The 5 best-ranked creators with at least one ACTIVE agent */
	@Field(() => [Member])
	faces!: Member[];
}
