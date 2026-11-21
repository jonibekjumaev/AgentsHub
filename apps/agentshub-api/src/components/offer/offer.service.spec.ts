import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { expectHttpError } from '../../../test/utils/http-error';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { createNotificationMock, NotificationMock } from '../../../test/utils/notification-mock';
import { NotificationService } from '../notification/notification.service';
import { OfferCloseReason, OfferStatus } from '../../libs/enums/offer.enum';
import { BriefStatus } from '../../libs/enums/brief.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { ProductStatus } from '../../libs/enums/product.enum';
import { Message } from '../../libs/enums/common.enum';
import { NotificationType } from '../../libs/enums/notification.enum';
import { OfferInput } from '../../libs/dto/offer/offer.input';
import { MemberService } from '../member/member.service';
import { OfferService } from './offer.service';

const { PENDING, ACCEPTED, DECLINED, WITHDRAWN, EXPIRED } = OfferStatus;

const creatorId = new Types.ObjectId();
const ownerId = new Types.ObjectId();
const strangerId = new Types.ObjectId();
const briefId = new Types.ObjectId();
const offerId = new Types.ObjectId();
const productId = new Types.ObjectId();

const NOW = new Date('2026-11-13T12:00:00.000Z');
const IN_14_DAYS = new Date('2026-11-27T12:00:00.000Z');
const YESTERDAY = new Date('2026-11-12T12:00:00.000Z');
const TOMORROW = new Date('2026-11-14T12:00:00.000Z');

const openBrief = (fields: object = {}) => ({
	_id: briefId,
	memberId: ownerId,
	briefStatus: BriefStatus.OPEN,
	...fields,
});
const storedOffer = (fields: object = {}) => ({
	_id: offerId,
	briefId,
	creatorId,
	userId: ownerId,
	offerStatus: PENDING,
	offerPrice: 300,
	offerDeliveryDays: 7,
	offerMessage: 'I built three support bots like this one.',
	sentAt: YESTERDAY,
	expiresAt: TOMORROW,
	...fields,
});

const duplicateKeyError = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });

describe('OfferService (D-48)', () => {
	let service: OfferService;
	let offerModel: MockModel;
	let briefModel: MockModel;
	let productModel: MockModel;
	let memberService: { getAuthorData: jest.Mock };
	let notifications: NotificationMock;

	beforeEach(async () => {
		notifications = createNotificationMock();
		offerModel = createMockModel();
		briefModel = createMockModel();
		productModel = createMockModel();
		memberService = { getAuthorData: jest.fn().mockResolvedValue({ _id: creatorId }) };

		const moduleRef = await Test.createTestingModule({
			providers: [
				OfferService,
				{ provide: NotificationService, useValue: notifications },
				{ provide: getModelToken('Offer'), useValue: offerModel },
				{ provide: getModelToken('Brief'), useValue: briefModel },
				{ provide: getModelToken('Product'), useValue: productModel },
				{ provide: MemberService, useValue: memberService },
			],
		}).compile();
		service = moduleRef.get(OfferService);

		jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	/** The first stage of the n-th aggregation */
	const firstStage = (n: number) => (offerModel.aggregate.mock.calls[n][0] as object[])[0];

	/** The $inc of briefOffers each write made, in order (none: []) */
	const briefOffersChanges = () =>
		briefModel.updateOne.mock.calls.map(([filter, update]) => {
			expect(filter).toEqual({ _id: briefId });
			return (update as { $inc: { briefOffers: number } }).$inc.briefOffers;
		});

	describe('createOffer', () => {
		const input = (fields: Partial<OfferInput> = {}): OfferInput => ({
			briefId,
			offerPrice: 300,
			offerDeliveryDays: 7,
			offerMessage: '   I built three support bots like this one.  ',
			...fields,
		});

		beforeEach(() => {
			offerModel.create.mockImplementation((doc: object) => Promise.resolve({ _id: offerId, ...doc }));
		});

		describe('a first offer', () => {
			it('stores it PENDING with the owner, the trimmed message, sentAt now and the 14-day expiry; briefOffers +1', async () => {
				briefModel.resolve('findOne', openBrief());
				offerModel.resolve('countDocuments', 0);

				await service.createOffer(creatorId, input());

				expect(offerModel.create).toHaveBeenCalledWith({
					briefId,
					creatorId,
					userId: ownerId,
					offerStatus: PENDING,
					offerPrice: 300,
					offerDeliveryDays: 7,
					offerMessage: 'I built three support bots like this one.',
					sentAt: NOW,
					expiresAt: IN_14_DAYS,
				});
				expect(briefOffersChanges()).toEqual([1]);
			});

			it('attaches the agent only if it is one of the creator’s ACTIVE agents', async () => {
				briefModel.resolve('findOne', openBrief());
				productModel.resolve('exists', { _id: productId });
				offerModel.resolve('countDocuments', 0);

				await service.createOffer(creatorId, input({ productId }));

				expect(productModel.exists).toHaveBeenCalledWith({
					_id: productId,
					memberId: creatorId,
					productStatus: ProductStatus.ACTIVE,
				});
				expect(offerModel.create.mock.calls[0][0]).toMatchObject({ productId });
			});

			it('someone else’s, paused or missing agent → BAD_REQUEST INVALID_OFFER_PRODUCT, nothing stored', async () => {
				briefModel.resolve('findOne', openBrief());
				productModel.resolve('exists', null);

				await expectHttpError(
					service.createOffer(creatorId, input({ productId })),
					BadRequestException,
					Message.INVALID_OFFER_PRODUCT,
				);
				expect(offerModel.create).not.toHaveBeenCalled();
			});
		});

		describe('which briefs take offers', () => {
			it.each([
				['a missing brief', null],
				['a deleted brief', openBrief({ briefStatus: BriefStatus.DELETE })],
			])('%s → NOT_FOUND (D-30)', async (_label, brief) => {
				briefModel.resolve('findOne', brief);
				await expectHttpError(service.createOffer(creatorId, input()), NotFoundException, Message.NO_DATA_FOUND);
				expect(offerModel.create).not.toHaveBeenCalled();
			});

			it('a CLOSED brief → BAD_REQUEST BRIEF_NOT_OPEN', async () => {
				briefModel.resolve('findOne', openBrief({ briefStatus: BriefStatus.CLOSED }));
				await expectHttpError(service.createOffer(creatorId, input()), BadRequestException, Message.BRIEF_NOT_OPEN);
			});
		});

		it('the 21st offer in 24 hours → BAD_REQUEST OFFER_DAILY_LIMIT, nothing stored', async () => {
			briefModel.resolve('findOne', openBrief());
			offerModel.resolve('countDocuments', 20);

			await expectHttpError(service.createOffer(creatorId, input()), BadRequestException, Message.OFFER_DAILY_LIMIT);
			expect(offerModel.countDocuments).toHaveBeenCalledWith({ creatorId, sentAt: { $gt: YESTERDAY } });
			expect(offerModel.create).not.toHaveBeenCalled();
		});

		describe('sending again: the same document, never a second one', () => {
			it.each([WITHDRAWN, EXPIRED])('a %s offer is re-opened in place; briefOffers +1', async (status) => {
				const existing = storedOffer({ offerStatus: status, expiresAt: undefined, closedAt: YESTERDAY });
				briefModel.resolve('findOne', openBrief());
				offerModel.resolve('findOne', existing).resolve('countDocuments', 0).resolve('findOneAndUpdate', existing);

				await service.createOffer(creatorId, input());

				expect(offerModel.create).not.toHaveBeenCalled();
				const [filter, update] = offerModel.findOneAndUpdate.mock.calls[0];
				// pinned to the state that was read: a concurrent change makes the write match nothing
				expect(filter).toEqual({ _id: offerId, offerStatus: status, expiresAt: { $exists: false } });
				expect(update).toMatchObject({
					$set: { offerStatus: PENDING, sentAt: NOW, expiresAt: IN_14_DAYS, userId: ownerId },
					$unset: { closedAt: 1, offerCloseReason: 1, productId: 1 },
				});
				expect(briefOffersChanges()).toEqual([1]);
			});

			it('a PENDING offer past its expiry is sent again with no counter change (it was still counted)', async () => {
				const existing = storedOffer({ expiresAt: YESTERDAY });
				briefModel.resolve('findOne', openBrief());
				offerModel.resolve('findOne', existing).resolve('countDocuments', 0).resolve('findOneAndUpdate', existing);

				await service.createOffer(creatorId, input());

				expect(offerModel.findOneAndUpdate.mock.calls[0][0]).toEqual({
					_id: offerId,
					offerStatus: PENDING,
					expiresAt: YESTERDAY,
				});
				expect(briefOffersChanges()).toEqual([]);
			});

			it('a PENDING offer → BAD_REQUEST OFFER_ALREADY_PENDING (edit it instead)', async () => {
				briefModel.resolve('findOne', openBrief());
				offerModel.resolve('findOne', storedOffer());

				await expectHttpError(
					service.createOffer(creatorId, input()),
					BadRequestException,
					Message.OFFER_ALREADY_PENDING,
				);
				expect(offerModel.findOneAndUpdate).not.toHaveBeenCalled();
			});

			it.each([
				['ACCEPTED', storedOffer({ offerStatus: ACCEPTED })],
				['DECLINED by the owner', storedOffer({ offerStatus: DECLINED })],
			])('a %s offer is final → INVALID_OFFER_STATUS_CHANGE', async (_label, existing) => {
				briefModel.resolve('findOne', openBrief());
				offerModel.resolve('findOne', existing);

				await expectHttpError(
					service.createOffer(creatorId, input()),
					BadRequestException,
					Message.INVALID_OFFER_STATUS_CHANGE,
				);
				expect(briefOffersChanges()).toEqual([]);
			});

			it('an offer DECLINED because the brief closed may be sent again once the brief reopened; +1', async () => {
				const existing = storedOffer({
					offerStatus: DECLINED,
					offerCloseReason: OfferCloseReason.BRIEF_CLOSED,
					expiresAt: undefined,
				});
				briefModel.resolve('findOne', openBrief());
				offerModel.resolve('findOne', existing).resolve('countDocuments', 0).resolve('findOneAndUpdate', existing);

				await service.createOffer(creatorId, input());
				expect(briefOffersChanges()).toEqual([1]);
			});
		});

		describe('two requests at the same moment', () => {
			it('two first offers (two tabs): the loser gets E11000 and is answered from the winner: one offer', async () => {
				briefModel.resolve('findOne', openBrief()).resolve('findOne', openBrief());
				offerModel.resolve('findOne', null).resolve('countDocuments', 0).resolve('findOne', storedOffer());
				offerModel.create.mockRejectedValueOnce(duplicateKeyError());

				await expectHttpError(
					service.createOffer(creatorId, input()),
					BadRequestException,
					Message.OFFER_ALREADY_PENDING,
				);
				expect(offerModel.create).toHaveBeenCalledTimes(1);
				expect(briefOffersChanges()).toEqual([]);
			});

			it('the offer changed between the read and the write: answered once from its state now', async () => {
				const withdrawn = storedOffer({ offerStatus: WITHDRAWN, expiresAt: undefined });
				briefModel.resolve('findOne', openBrief()).resolve('findOne', openBrief());
				offerModel
					.resolve('findOne', withdrawn)
					.resolve('countDocuments', 0)
					.resolve('findOneAndUpdate', null) // someone else re-sent it in between
					.resolve('findOne', storedOffer()); // now PENDING

				await expectHttpError(
					service.createOffer(creatorId, input()),
					BadRequestException,
					Message.OFFER_ALREADY_PENDING,
				);
				expect(briefOffersChanges()).toEqual([]);
			});
		});
	});

	describe('updateOffer', () => {
		it('edits a PENDING offer, trims the message and restarts the expiry; no counter change', async () => {
			offerModel.resolve('findOne', storedOffer()).resolve('findOneAndUpdate', storedOffer());

			await service.updateOffer(creatorId, {
				_id: offerId,
				offerPrice: 250,
				offerMessage: '  A shorter pitch, still long enough. ',
			});

			const [filter, update] = offerModel.findOneAndUpdate.mock.calls[0];
			expect(filter).toEqual({ _id: offerId, creatorId, offerStatus: PENDING, expiresAt: { $gt: NOW } });
			expect(update).toEqual({
				$set: { offerPrice: 250, offerMessage: 'A shorter pitch, still long enough.', expiresAt: IN_14_DAYS },
			});
			expect(briefOffersChanges()).toEqual([]);
		});

		it('productId null detaches the agent', async () => {
			offerModel.resolve('findOne', storedOffer({ productId })).resolve('findOneAndUpdate', storedOffer());
			await service.updateOffer(creatorId, { _id: offerId, productId: null });

			expect(offerModel.findOneAndUpdate.mock.calls[0][1]).toEqual({
				$set: { expiresAt: IN_14_DAYS },
				$unset: { productId: 1 },
			});
			expect(productModel.exists).not.toHaveBeenCalled();
		});

		it("someone else's or a missing offer → NOT_FOUND", async () => {
			await expectHttpError(
				service.updateOffer(strangerId, { _id: offerId }),
				NotFoundException,
				Message.NO_DATA_FOUND,
			);
			expect(offerModel.findOne).toHaveBeenCalledWith({ _id: offerId, creatorId: strangerId });
		});

		it('an expired offer → OFFER_EXPIRED; a closed one → INVALID_OFFER_STATUS_CHANGE', async () => {
			offerModel.resolve('findOne', storedOffer({ expiresAt: YESTERDAY }));
			await expectHttpError(
				service.updateOffer(creatorId, { _id: offerId }),
				BadRequestException,
				Message.OFFER_EXPIRED,
			);

			offerModel.resolve('findOne', storedOffer({ offerStatus: ACCEPTED, expiresAt: undefined }));
			await expectHttpError(
				service.updateOffer(creatorId, { _id: offerId }),
				BadRequestException,
				Message.INVALID_OFFER_STATUS_CHANGE,
			);
			expect(offerModel.findOneAndUpdate).not.toHaveBeenCalled();
		});
	});

	describe('accept, decline, withdraw', () => {
		it('withdraw: only the creator’s own PENDING offer; WITHDRAWN, closedAt now, no expiry; briefOffers -1', async () => {
			offerModel.resolve('findOne', storedOffer()).resolve('findOneAndUpdate', storedOffer({ offerStatus: WITHDRAWN }));

			await service.withdrawOffer(creatorId, offerId);

			expect(offerModel.findOne).toHaveBeenCalledWith({ _id: offerId, creatorId });
			expect(offerModel.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: offerId, creatorId, offerStatus: PENDING, expiresAt: { $gt: NOW } },
				{ $set: { offerStatus: WITHDRAWN, closedAt: NOW }, $unset: { expiresAt: 1 } },
				{ new: true },
			);
			expect(briefOffersChanges()).toEqual([-1]);
		});

		it('accept: only on the owner’s brief, while it is OPEN; ACCEPTED stays counted (0)', async () => {
			offerModel.resolve('findOne', storedOffer()).resolve('findOneAndUpdate', storedOffer({ offerStatus: ACCEPTED }));
			briefModel.resolve('exists', { _id: briefId });

			await service.acceptOffer(ownerId, offerId);

			expect(offerModel.findOne).toHaveBeenCalledWith({ _id: offerId, userId: ownerId });
			expect(briefModel.exists).toHaveBeenCalledWith({ _id: briefId, briefStatus: BriefStatus.OPEN });
			expect(offerModel.findOneAndUpdate.mock.calls[0][1]).toMatchObject({ $set: { offerStatus: ACCEPTED } });
			expect(briefOffersChanges()).toEqual([]);
		});

		it('accept on a brief that is no longer OPEN → BRIEF_NOT_OPEN (the decline on close may have failed)', async () => {
			offerModel.resolve('findOne', storedOffer());
			briefModel.resolve('exists', null);

			await expectHttpError(service.acceptOffer(ownerId, offerId), BadRequestException, Message.BRIEF_NOT_OPEN);
			expect(offerModel.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('accept the offer of a deleted creator → NOT_ALLOWED_REQUEST (D-38)', async () => {
			offerModel.resolve('findOne', storedOffer());
			briefModel.resolve('exists', { _id: briefId });
			memberService.getAuthorData.mockResolvedValueOnce(null);

			await expectHttpError(service.acceptOffer(ownerId, offerId), BadRequestException, Message.NOT_ALLOWED_REQUEST);
		});

		it('decline: DECLINED; briefOffers -1', async () => {
			offerModel.resolve('findOne', storedOffer()).resolve('findOneAndUpdate', storedOffer({ offerStatus: DECLINED }));

			await service.declineOffer(ownerId, offerId);

			expect(offerModel.findOneAndUpdate.mock.calls[0][1]).toMatchObject({ $set: { offerStatus: DECLINED } });
			expect(briefOffersChanges()).toEqual([-1]);
		});

		it.each([
			['accept', (s: OfferService) => s.acceptOffer(strangerId, offerId)],
			['decline', (s: OfferService) => s.declineOffer(strangerId, offerId)],
		])("%s an offer on someone else's brief → NOT_FOUND", async (_label, run) => {
			await expectHttpError(run(service), NotFoundException, Message.NO_DATA_FOUND);
			expect(offerModel.findOne).toHaveBeenCalledWith({ _id: offerId, userId: strangerId });
		});

		it('an expired offer can be neither accepted nor declined nor withdrawn → OFFER_EXPIRED', async () => {
			for (const run of [
				() => service.acceptOffer(ownerId, offerId),
				() => service.declineOffer(ownerId, offerId),
				() => service.withdrawOffer(creatorId, offerId),
			]) {
				offerModel.resolve('findOne', storedOffer({ expiresAt: YESTERDAY }));
				await expectHttpError(run(), BadRequestException, Message.OFFER_EXPIRED);
			}
			expect(offerModel.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('the owner accepts while the creator withdraws: the loser matches nothing and is told why; no counter change', async () => {
			offerModel
				.resolve('findOne', storedOffer())
				.resolve('findOneAndUpdate', null) // the creator's withdraw came first
				.resolve('findOne', storedOffer({ offerStatus: WITHDRAWN, expiresAt: undefined }));
			briefModel.resolve('exists', { _id: briefId });

			await expectHttpError(
				service.acceptOffer(ownerId, offerId),
				BadRequestException,
				Message.INVALID_OFFER_STATUS_CHANGE,
			);
			expect(briefOffersChanges()).toEqual([]);
		});
	});

	describe('D-50: notifications', () => {
		const input = (): OfferInput => ({ briefId, offerPrice: 300, offerDeliveryDays: 7, offerMessage: 'Hello there' });

		it('a first offer notifies the brief owner with the stored offer', async () => {
			const created = storedOffer();
			briefModel.resolve('findOne', openBrief());
			offerModel.resolve('countDocuments', 0);
			offerModel.create.mockResolvedValueOnce(created);

			await service.createOffer(creatorId, input());

			expect(notifications.notifyOffer).toHaveBeenCalledWith(NotificationType.OFFER_RECEIVED, created);
		});

		it('sending again notifies the owner again', async () => {
			const reopened = storedOffer();
			briefModel.resolve('findOne', openBrief());
			offerModel
				.resolve('findOne', storedOffer({ offerStatus: WITHDRAWN, expiresAt: undefined }))
				.resolve('countDocuments', 0)
				.resolve('findOneAndUpdate', reopened);

			await service.createOffer(creatorId, input());

			expect(notifications.notifyOffer).toHaveBeenCalledWith(NotificationType.OFFER_RECEIVED, reopened);
		});

		it.each([
			['accept', ACCEPTED, NotificationType.OFFER_ACCEPTED],
			['decline', DECLINED, NotificationType.OFFER_DECLINED],
			['withdraw', WITHDRAWN, NotificationType.OFFER_WITHDRAWN],
		] as const)('%s notifies the other side with %s', async (action, status, type) => {
			const closed = storedOffer({ offerStatus: status });
			offerModel.resolve('findOne', storedOffer()).resolve('findOneAndUpdate', closed);
			briefModel.resolve('exists', { _id: briefId });

			if (action === 'accept') await service.acceptOffer(ownerId, offerId);
			if (action === 'decline') await service.declineOffer(ownerId, offerId);
			if (action === 'withdraw') await service.withdrawOffer(creatorId, offerId);

			expect(notifications.notifyOffer).toHaveBeenCalledTimes(1);
			expect(notifications.notifyOffer).toHaveBeenCalledWith(type, closed);
		});

		it('a write that lost the race notifies nobody', async () => {
			offerModel
				.resolve('findOne', storedOffer())
				.resolve('findOneAndUpdate', null)
				.resolve('findOne', storedOffer({ offerStatus: WITHDRAWN }));
			briefModel.resolve('exists', { _id: briefId });

			await expect(service.acceptOffer(ownerId, offerId)).rejects.toThrow();
			expect(notifications.notifyOffer).not.toHaveBeenCalled();
		});

		it('closing a brief declines its offers without a notification per offer', async () => {
			offerModel.resolve('updateMany', { modifiedCount: 3 });
			await service.declinePendingOffersOfBrief(briefId);
			expect(notifications.notifyOffer).not.toHaveBeenCalled();
		});
	});

	describe('declinePendingOffersOfBrief (a brief closed or deleted)', () => {
		it('declines every PENDING offer with BRIEF_CLOSED and lowers briefOffers by exactly that many', async () => {
			offerModel.resolve('updateMany', { modifiedCount: 3 });

			await expect(service.declinePendingOffersOfBrief(briefId)).resolves.toBe(3);

			expect(offerModel.updateMany).toHaveBeenCalledWith(
				{ briefId, offerStatus: PENDING },
				{
					$set: { offerStatus: DECLINED, offerCloseReason: OfferCloseReason.BRIEF_CLOSED, closedAt: NOW },
					$unset: { expiresAt: 1 },
				},
			);
			expect(briefOffersChanges()).toEqual([-3]);
		});

		it('no PENDING offers: no counter write', async () => {
			offerModel.resolve('updateMany', { modifiedCount: 0 });
			await service.declinePendingOffersOfBrief(briefId);
			expect(briefOffersChanges()).toEqual([]);
		});
	});

	describe('who reads offers', () => {
		it('getOffer: a member reads only an offer they sent or received; an admin any', async () => {
			offerModel.resolve('aggregate', [storedOffer()]).resolve('aggregate', [storedOffer()]);

			await service.getOffer({ _id: strangerId, memberType: MemberType.CREATOR, memberNick: 'x' }, offerId);
			expect(firstStage(0)).toEqual({
				$match: { _id: offerId, $or: [{ creatorId: strangerId }, { userId: strangerId }] },
			});

			await service.getOffer({ _id: strangerId, memberType: MemberType.ADMIN, memberNick: 'admin' }, offerId);
			expect(firstStage(1)).toEqual({ $match: { _id: offerId } });
		});

		it('getOffer: nothing matched → NOT_FOUND', async () => {
			offerModel.resolve('aggregate', []);
			await expectHttpError(
				service.getOffer({ _id: strangerId, memberType: MemberType.USER, memberNick: 'x' }, offerId),
				NotFoundException,
				Message.NO_DATA_FOUND,
			);
		});

		it("getBriefOffers: someone else's (or a deleted) brief → NOT_FOUND", async () => {
			briefModel.resolve('exists', null);
			await expectHttpError(
				service.getBriefOffers(strangerId, { page: 1, limit: 10, search: { briefId } }),
				NotFoundException,
				Message.NO_DATA_FOUND,
			);
		});

		it('getBriefOffers: an expired PENDING offer is answered as EXPIRED, with the invited mark', async () => {
			briefModel.resolve('exists', { _id: briefId });
			offerModel.resolve('aggregate', [
				{
					list: [
						{ ...storedOffer({ expiresAt: YESTERDAY }), invitedRows: [{}] },
						{ ...storedOffer({ _id: new Types.ObjectId() }), invitedRows: [] },
					],
					metaCounter: [{ total: 2 }],
				},
			]);

			const result = await service.getBriefOffers(ownerId, { page: 1, limit: 10, search: { briefId } });

			expect(result.list.map((offer) => [offer.offerStatus, offer.invited])).toEqual([
				[EXPIRED, true],
				[PENDING, false],
			]);
			expect(result.list[0].expiresAt).toBeUndefined();
			expect(result.list[0]).not.toHaveProperty('invitedRows');
		});

		it('getMyOffers: the status filter follows what the caller sees (PENDING leaves out expired ones)', async () => {
			offerModel.resolve('aggregate', [{ list: [], metaCounter: [] }]);
			await service.getMyOffers(creatorId, { page: 1, limit: 10, search: { offerStatus: PENDING } });

			expect(firstStage(0)).toEqual({
				$match: { creatorId, offerStatus: PENDING, expiresAt: { $gt: NOW } },
			});
		});
	});
});
