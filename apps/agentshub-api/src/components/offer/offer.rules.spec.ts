import { BadRequestException } from '@nestjs/common';
import { OfferCloseReason, OfferStatus } from '../../libs/enums/offer.enum';
import { Message } from '../../libs/enums/common.enum';
import {
	assertOfferTransition,
	briefOffersDelta,
	effectiveOfferStatus,
	OfferActor,
	offerStatusMatch,
} from './offer.rules';

const { PENDING, ACCEPTED, DECLINED, WITHDRAWN, EXPIRED } = OfferStatus;
const { CREATOR, OWNER, SYSTEM } = OfferActor;

describe('offer rules (D-48)', () => {
	describe('assertOfferTransition: the state machine', () => {
		const allowed: [OfferStatus, OfferStatus, OfferActor][] = [
			[PENDING, ACCEPTED, OWNER],
			[PENDING, DECLINED, OWNER],
			[PENDING, DECLINED, SYSTEM], // the brief closed
			[PENDING, WITHDRAWN, CREATOR],
			[PENDING, EXPIRED, SYSTEM],
			[WITHDRAWN, PENDING, CREATOR], // sent again
			[EXPIRED, PENDING, CREATOR], // sent again
		];

		it.each(allowed)('%s → %s by %s is allowed', (from, to, actor) => {
			expect(() => assertOfferTransition(from, to, actor)).not.toThrow();
		});

		// every other (from, to, actor) combination, generated, so a new row in the table can't slip in unnoticed
		const statuses = Object.values(OfferStatus);
		const refused = statuses.flatMap((from) =>
			statuses.flatMap((to) =>
				Object.values(OfferActor)
					.filter((actor) => !allowed.some(([f, t, a]) => f === from && t === to && a === actor))
					.map((actor): [OfferStatus, OfferStatus, OfferActor] => [from, to, actor]),
			),
		);

		it.each(refused)('%s → %s by %s is refused with INVALID_OFFER_STATUS_CHANGE', (from, to, actor) => {
			expect(() => assertOfferTransition(from, to, actor)).toThrow(BadRequestException);
			expect(() => assertOfferTransition(from, to, actor)).toThrow(Message.INVALID_OFFER_STATUS_CHANGE);
		});

		it('ACCEPTED and DECLINED (by the owner) are final', () => {
			for (const to of statuses) {
				for (const actor of Object.values(OfferActor)) {
					expect(() => assertOfferTransition(ACCEPTED, to, actor)).toThrow();
					expect(() => assertOfferTransition(DECLINED, to, actor)).toThrow();
				}
			}
		});

		it('a DECLINED offer the brief closed may be sent again by its creator, only', () => {
			const reason = OfferCloseReason.BRIEF_CLOSED;
			expect(() => assertOfferTransition(DECLINED, PENDING, CREATOR, reason)).not.toThrow();
			expect(() => assertOfferTransition(DECLINED, PENDING, OWNER, reason)).toThrow();
			expect(() => assertOfferTransition(DECLINED, ACCEPTED, CREATOR, reason)).toThrow();
			expect(() => assertOfferTransition(DECLINED, PENDING, CREATOR, null)).toThrow();
		});
	});

	describe('effectiveOfferStatus: expiry on read', () => {
		const now = new Date('2026-11-13T12:00:00.000Z');

		it('a PENDING offer past (or at) its expiry is EXPIRED', () => {
			expect(effectiveOfferStatus({ offerStatus: PENDING, expiresAt: new Date('2026-11-13T11:59:59.000Z') }, now)).toBe(
				EXPIRED,
			);
			expect(effectiveOfferStatus({ offerStatus: PENDING, expiresAt: now }, now)).toBe(EXPIRED);
		});

		it('a PENDING offer before its expiry stays PENDING; other statuses are never changed', () => {
			const later = new Date('2026-11-14T12:00:00.000Z');
			expect(effectiveOfferStatus({ offerStatus: PENDING, expiresAt: later }, now)).toBe(PENDING);
			expect(effectiveOfferStatus({ offerStatus: ACCEPTED, expiresAt: new Date(0) }, now)).toBe(ACCEPTED);
			expect(effectiveOfferStatus({ offerStatus: WITHDRAWN }, now)).toBe(WITHDRAWN);
		});
	});

	describe('briefOffersDelta: briefOffers counts PENDING + ACCEPTED (stored)', () => {
		it.each([
			[null, PENDING, 1], // a new offer
			[WITHDRAWN, PENDING, 1], // sent again
			[EXPIRED, PENDING, 1],
			[DECLINED, PENDING, 1], // sent again after the brief reopened
			[PENDING, PENDING, 0], // sent again while stored PENDING but past its expiry
			[PENDING, ACCEPTED, 0],
			[PENDING, DECLINED, -1],
			[PENDING, WITHDRAWN, -1],
			[PENDING, EXPIRED, -1],
		])('%s → %s changes it by %i', (from, to, delta) => {
			expect(briefOffersDelta(from, to)).toBe(delta);
		});
	});

	describe('offerStatusMatch: list filters as the caller sees the status', () => {
		const now = new Date('2026-11-13T12:00:00.000Z');

		it('no status: no filter', () => {
			expect(offerStatusMatch(undefined, now)).toEqual({});
		});

		it('PENDING leaves out the expired ones; EXPIRED adds them', () => {
			expect(offerStatusMatch(PENDING, now)).toEqual({ offerStatus: PENDING, expiresAt: { $gt: now } });
			expect(offerStatusMatch(EXPIRED, now)).toEqual({
				$or: [{ offerStatus: EXPIRED }, { offerStatus: PENDING, expiresAt: { $lte: now } }],
			});
		});

		it('the final statuses filter as stored', () => {
			expect(offerStatusMatch(ACCEPTED, now)).toEqual({ offerStatus: ACCEPTED });
		});
	});
});
