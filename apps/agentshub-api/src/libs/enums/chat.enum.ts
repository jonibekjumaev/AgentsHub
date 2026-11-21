import { registerEnumType } from '@nestjs/graphql';

/** D-49: why a conversation takes no new messages. Computed on every read, never stored (except the admin lock). */
export enum ConversationReadOnlyReason {
	/** the offer is no longer PENDING or ACCEPTED */
	OFFER_CLOSED = 'OFFER_CLOSED',
	/** one of the two members is blocked or deleted */
	MEMBER_UNAVAILABLE = 'MEMBER_UNAVAILABLE',
	LOCKED_BY_ADMIN = 'LOCKED_BY_ADMIN',
}
registerEnumType(ConversationReadOnlyReason, {
	name: 'ConversationReadOnlyReason',
});
