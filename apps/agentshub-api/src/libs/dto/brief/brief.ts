import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from '../../types/common';
import { BriefBudgetType, BriefStatus } from '../../enums/brief.enum';
import { AgentCategory } from '../../enums/agent-category.enum';
import { Member, TotalCounter } from '../member/member';
import { CategoryFacet } from '../facet';

@ObjectType()
export class Brief {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => AgentCategory)
	briefCategory!: AgentCategory;

	@Field(() => BriefStatus)
	briefStatus!: BriefStatus;

	@Field(() => String)
	briefTitle!: string;

	@Field(() => String)
	briefContent!: string;

	// null means "open to offers" (D-04)
	@Field(() => Float, { nullable: true })
	briefBudget?: number;

	@Field(() => Date, { nullable: true })
	briefDeadline?: Date;

	@Field(() => Int)
	briefViews!: number;

	@Field(() => Int)
	briefComments!: number;

	@Field(() => String)
	memberId!: ObjectId;

	@Field(() => Date, { nullable: true })
	closedAt?: Date;

	@Field(() => Date, { nullable: true })
	deletedAt?: Date;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;

	/** from aggregation */

	@Field(() => Member, { nullable: true })
	memberData?: Member;
}

@ObjectType()
export class Briefs {
	@Field(() => [Brief])
	list!: Brief[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter!: TotalCounter[];
}

/** D-44: the number of briefs with one budget type, for the /briefs filters. */
@ObjectType()
export class BudgetTypeFacet {
	@Field(() => BriefBudgetType)
	value!: BriefBudgetType;

	@Field(() => Int)
	count!: number;
}

/** D-44: the number of briefs with one status (OPEN or CLOSED, never DELETE), for the /briefs tabs. */
@ObjectType()
export class BriefStatusFacet {
	@Field(() => BriefStatus)
	value!: BriefStatus;

	@Field(() => Int)
	count!: number;
}

/** D-44: live counts next to the /briefs filters. Each group is counted without its own filter. */
@ObjectType()
export class BriefFacets {
	@Field(() => [CategoryFacet])
	categories!: CategoryFacet[];

	@Field(() => [BudgetTypeFacet])
	budgetTypes!: BudgetTypeFacet[];

	@Field(() => [BriefStatusFacet])
	statuses!: BriefStatusFacet[];
}

/** D-44: the /briefs live badge: OPEN briefs whose deadline has not passed, and the sum of their fixed budgets. */
@ObjectType()
export class OpenBriefStats {
	@Field(() => Int)
	openNow!: number;

	/** USD (D-06), rounded to cents */
	@Field(() => Float)
	budgetTotal!: number;
}
