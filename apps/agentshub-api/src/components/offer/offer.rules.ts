import { BadRequestException } from '@nestjs/common';
import { countedOfferStatuses, OfferCloseReason, OfferStatus } from '../../libs/enums/offer.enum';
import { Message } from '../../libs/enums/common.enum';
import type { T } from '../../libs/types/common';

/** Who moves an offer: its creator, the brief's owner, or the system (brief closed, expiry). */
export enum OfferActor {
	CREATOR = 'CREATOR',
	OWNER = 'OWNER',
	SYSTEM = 'SYSTEM',
}

/**
 * D-48: the state machine, as one table: from → to → who may make that move. Anything not listed is refused.
 * DECLINED → PENDING is not in the table: only a decline by the brief closing allows it (see assertOfferTransition).
 */
const offerTransitions: Record<OfferStatus, Partial<Record<OfferStatus, OfferActor[]>>> = {
	[OfferStatus.PENDING]: {
		[OfferStatus.ACCEPTED]: [OfferActor.OWNER],
		[OfferStatus.DECLINED]: [OfferActor.OWNER, OfferActor.SYSTEM],
		[OfferStatus.WITHDRAWN]: [OfferActor.CREATOR],
		[OfferStatus.EXPIRED]: [OfferActor.SYSTEM],
	},
	[OfferStatus.WITHDRAWN]: { [OfferStatus.PENDING]: [OfferActor.CREATOR] },
	[OfferStatus.EXPIRED]: { [OfferStatus.PENDING]: [OfferActor.CREATOR] },
	[OfferStatus.ACCEPTED]: {},
	[OfferStatus.DECLINED]: {},
};

/**
 * Throws BAD_REQUEST INVALID_OFFER_STATUS_CHANGE unless `actor` may move an offer from `from` to `to`. `from` is the
 * status the caller sees (effectiveOfferStatus), not the stored one.
 *
 * A DECLINED offer is final, except one the brief declined when it closed (BRIEF_CLOSED): if the owner reopens the
 * brief, the creator may send it again. Otherwise every creator would be locked out of a reopened brief.
 */
export const assertOfferTransition = (
	from: OfferStatus,
	to: OfferStatus,
	actor: OfferActor,
	closeReason?: OfferCloseReason | null,
): void => {
	const reopensClosedBrief =
		from === OfferStatus.DECLINED &&
		to === OfferStatus.PENDING &&
		actor === OfferActor.CREATOR &&
		closeReason === OfferCloseReason.BRIEF_CLOSED;
	if (reopensClosedBrief) return;

	if (!offerTransitions[from][to]?.includes(actor)) {
		throw new BadRequestException(Message.INVALID_OFFER_STATUS_CHANGE);
	}
};

/** D-48: a PENDING offer whose expiry has passed is EXPIRED for everyone, before the daily job stores it. */
export const effectiveOfferStatus = (
	offer: { offerStatus: OfferStatus; expiresAt?: Date | null },
	now: Date = new Date(),
): OfferStatus => {
	const isPastExpiry = !!offer.expiresAt && offer.expiresAt.getTime() <= now.getTime();
	return offer.offerStatus === OfferStatus.PENDING && isPastExpiry ? OfferStatus.EXPIRED : offer.offerStatus;
};

/**
 * The change to Brief.briefOffers when an offer's STORED status moves from `from` to `to`. Stored, not effective: a
 * PENDING offer past its expiry is still counted until a write moves it, so re-sending it changes nothing (0).
 */
export const briefOffersDelta = (from: OfferStatus | null, to: OfferStatus): number => {
	const counted = (status: OfferStatus | null) => (status && countedOfferStatuses.includes(status) ? 1 : 0);
	return counted(to) - counted(from);
};

/** The list filter for one status as the caller sees it: PENDING leaves out expired ones, EXPIRED adds them. */
export const offerStatusMatch = (status: OfferStatus | undefined, now: Date): T => {
	if (!status) return {};
	if (status === OfferStatus.PENDING) return { offerStatus: OfferStatus.PENDING, expiresAt: { $gt: now } };
	if (status === OfferStatus.EXPIRED) {
		return {
			$or: [{ offerStatus: OfferStatus.EXPIRED }, { offerStatus: OfferStatus.PENDING, expiresAt: { $lte: now } }],
		};
	}
	return { offerStatus: status };
};
