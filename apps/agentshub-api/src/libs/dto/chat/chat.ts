import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from '../../types/common';
import { ConversationReadOnlyReason } from '../../enums/chat.enum';
import { BriefStatus } from '../../enums/brief.enum';
import { OfferStatus } from '../../enums/offer.enum';
import { Member, TotalCounter } from '../member/member';

/** D-49: one message. Plain text: render it as text, never as HTML. */
@ObjectType()
export class ChatMessage {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => String)
	conversationId!: ObjectId;

	@Field(() => String)
	senderId!: ObjectId;

	@Field(() => String)
	messageText!: string;

	@Field(() => String)
	clientMessageId!: string;

	@Field(() => Date)
	createdAt!: Date;
}

/** A page of history, oldest first. `hasMore`: there are more in the direction asked for (before / after). */
@ObjectType()
export class ChatMessages {
	@Field(() => [ChatMessage])
	list!: ChatMessage[];

	@Field(() => Boolean)
	hasMore!: boolean;
}

/** The brief a conversation is about. */
@ObjectType()
export class ConversationBrief {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => String)
	briefTitle!: string;

	@Field(() => BriefStatus)
	briefStatus!: BriefStatus;
}

/** The offer a conversation is about; offerStatus as the members see it (expired PENDING → EXPIRED). */
@ObjectType()
export class ConversationOffer {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => OfferStatus)
	offerStatus!: OfferStatus;

	@Field(() => Float)
	offerPrice!: number;

	@Field(() => Int)
	offerDeliveryDays!: number;
}

@ObjectType()
export class Conversation {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => String)
	offerId!: ObjectId;

	@Field(() => String)
	briefId!: ObjectId;

	/** the brief's owner */
	@Field(() => String)
	userId!: ObjectId;

	@Field(() => String)
	creatorId!: ObjectId;

	@Field(() => Date, { nullable: true })
	lastMessageAt?: Date;

	@Field(() => String, { nullable: true })
	lastMessagePreview?: string;

	@Field(() => String, { nullable: true })
	lastSenderId?: ObjectId;

	@Field(() => Boolean)
	lockedByAdmin!: boolean;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;

	/** computed */

	/** whether a message can be sent now (D-49) */
	@Field(() => Boolean)
	canWrite!: boolean;

	/** null while canWrite */
	@Field(() => ConversationReadOnlyReason, { nullable: true })
	readOnlyReason?: ConversationReadOnlyReason | null;

	/** the caller's unread messages; null for an admin */
	@Field(() => Int, { nullable: true })
	meUnread?: number | null;

	/** null for a deleted member (D-38) */
	@Field(() => Member, { nullable: true })
	userData?: Member | null;

	@Field(() => Member, { nullable: true })
	creatorData?: Member | null;

	@Field(() => ConversationBrief, { nullable: true })
	briefData?: ConversationBrief | null;

	@Field(() => ConversationOffer, { nullable: true })
	offerData?: ConversationOffer | null;
}

@ObjectType()
export class Conversations {
	@Field(() => [Conversation])
	list!: Conversation[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter!: TotalCounter[];
}
