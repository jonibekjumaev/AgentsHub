import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from '../../types/common';
import { BriefStatus } from '../../enums/brief.enum';
import { AgentCategory } from '../../enums/agent-category.enum';
import { Member, TotalCounter } from '../member/member';

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
