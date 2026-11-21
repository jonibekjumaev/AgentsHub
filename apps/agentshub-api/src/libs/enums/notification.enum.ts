import { registerEnumType } from '@nestjs/graphql';

/**
 * D-50: what happened. LIKE is kept from Nestar but nothing sends it (a like is a counter, not news).
 * OFFER_RECEIVED also covers an offer sent again; OFFER_WITHDRAWN goes to the brief's owner, ACCEPTED/DECLINED to the
 * creator. INVITE: the brief's owner invited the creator. FOLLOW: once per follower, however often they re-follow.
 */
export enum NotificationType {
	LIKE = 'LIKE',
	COMMENT = 'COMMENT',
	FOLLOW = 'FOLLOW',
	OFFER_RECEIVED = 'OFFER_RECEIVED',
	OFFER_ACCEPTED = 'OFFER_ACCEPTED',
	OFFER_DECLINED = 'OFFER_DECLINED',
	OFFER_WITHDRAWN = 'OFFER_WITHDRAWN',
	INVITE = 'INVITE',
}
registerEnumType(NotificationType, {
	name: 'NotificationType',
});

export enum NotificationStatus {
	WAIT = 'WAIT',
	READ = 'READ',
}
registerEnumType(NotificationStatus, {
	name: 'NotificationStatus',
});

export enum NotificationGroup {
	MEMBER = 'MEMBER',
	ARTICLE = 'ARTICLE',
	PRODUCT = 'PRODUCT',
	BRIEF = 'BRIEF',
}
registerEnumType(NotificationGroup, {
	name: 'NotificationGroup',
});
