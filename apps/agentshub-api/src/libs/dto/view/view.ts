import { Field, Int, ObjectType } from '@nestjs/graphql';
import { ViewGroup } from '../../enums/view.enum';
import type { ObjectId } from '../../types/common';
import { Member, TotalCounter } from '../member/member';

@ObjectType()
export class View {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => ViewGroup)
	viewGroup!: ViewGroup;

	@Field(() => String)
	viewRefId!: ObjectId;

	@Field(() => String)
	memberId!: ObjectId;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;
}

/** One visit of my profile (D-42): who, and when they last opened it. */
@ObjectType()
export class ProfileVisit {
	/** The view's id: stable key for the client list */
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => Member)
	visitor!: Member;

	/** The latest visit (the view's updatedAt, B24) */
	@Field(() => Date)
	visitedAt!: Date;
}

@ObjectType()
export class ProfileVisitors {
	@Field(() => [ProfileVisit])
	list!: ProfileVisit[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter?: TotalCounter[];

	/** Visitors in the same window who browse privately: counted, never named */
	@Field(() => Int)
	privateCount!: number;
}
