import { registerEnumType } from '@nestjs/graphql';

/**
 * D-48: the life of an offer. ACCEPTED and DECLINED are final, except a DECLINED offer the brief closed
 * (offerCloseReason BRIEF_CLOSED), which its creator may send again if the brief reopens. The moves are in
 * OfferService.assertOfferTransition.
 */
export enum OfferStatus {
	PENDING = 'PENDING',
	ACCEPTED = 'ACCEPTED',
	DECLINED = 'DECLINED',
	WITHDRAWN = 'WITHDRAWN',
	EXPIRED = 'EXPIRED',
}
registerEnumType(OfferStatus, {
	name: 'OfferStatus',
});

/** D-48: why an offer was closed by something other than its creator or the brief's owner. */
export enum OfferCloseReason {
	BRIEF_CLOSED = 'BRIEF_CLOSED',
}
registerEnumType(OfferCloseReason, {
	name: 'OfferCloseReason',
});

/** D-48: the stored statuses Brief.briefOffers counts. */
export const countedOfferStatuses: OfferStatus[] = [OfferStatus.PENDING, OfferStatus.ACCEPTED];
