import { Field, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from '../../types/common';
import { Member, TotalCounter } from '../member/member';
import { Brief } from '../brief/brief';

/** D-48: a brief's owner asks a creator to send an offer. */
@ObjectType()
export class Invite {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => String)
	briefId!: ObjectId;

	/** the brief's owner */
	@Field(() => String)
	userId!: ObjectId;

	@Field(() => String)
	creatorId!: ObjectId;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;

	/** from aggregation (getMyInvites) */

	@Field(() => Brief, { nullable: true })
	briefData?: Brief;

	/** null for a deleted owner (D-38) */
	@Field(() => Member, { nullable: true })
	userData?: Member;
}

@ObjectType()
export class Invites {
	@Field(() => [Invite])
	list!: Invite[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter!: TotalCounter[];
}
