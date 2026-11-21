import { Types } from 'mongoose';
import { invalidFields, validationErrors, without } from '../../../../test/utils/validate-dto';
import { offerDeliveryDaysMax, offerDeliveryDaysMin, offerMessageMaxLength, offerMessageMinLength } from '../../config';
import { Message } from '../../enums/common.enum';
import { BriefOffersInquiry, OfferInput, OfferUpdate } from './offer.input';

const offer = {
	briefId: new Types.ObjectId().toHexString(),
	offerPrice: 300,
	offerDeliveryDays: 7,
	offerMessage: 'I built three support bots like this one.',
};

describe('OfferInput (D-48)', () => {
	it('accepts the base input, with or without an agent', async () => {
		expect(await invalidFields(OfferInput, offer)).toEqual([]);
		expect(await invalidFields(OfferInput, { ...offer, productId: new Types.ObjectId().toHexString() })).toEqual([]);
	});

	it.each(['briefId', 'offerPrice', 'offerDeliveryDays', 'offerMessage'])('requires %s', async (key) => {
		expect(await invalidFields(OfferInput, without(offer, key))).toEqual([key]);
	});

	it.each([0, -5])('rejects a price of %p with INVALID_OFFER_PRICE', async (offerPrice) => {
		expect(await validationErrors(OfferInput, { ...offer, offerPrice })).toEqual({
			offerPrice: [Message.INVALID_OFFER_PRICE],
		});
	});

	it.each([offerDeliveryDaysMin, offerDeliveryDaysMax])('accepts %p delivery days', async (offerDeliveryDays) => {
		expect(await invalidFields(OfferInput, { ...offer, offerDeliveryDays })).toEqual([]);
	});

	it.each([offerDeliveryDaysMin - 1, offerDeliveryDaysMax + 1, 2.5])(
		'rejects %p delivery days (whole days, 1–365)',
		async (offerDeliveryDays) => {
			expect(await invalidFields(OfferInput, { ...offer, offerDeliveryDays })).toEqual(['offerDeliveryDays']);
		},
	);

	it.each([offerMessageMinLength, offerMessageMaxLength])('accepts a %p-character message', async (length) => {
		expect(await invalidFields(OfferInput, { ...offer, offerMessage: 'a'.repeat(length) })).toEqual([]);
	});

	it.each([offerMessageMinLength - 1, offerMessageMaxLength + 1])('rejects a %p-character message', async (length) => {
		expect(await invalidFields(OfferInput, { ...offer, offerMessage: 'a'.repeat(length) })).toEqual(['offerMessage']);
	});

	it('counts the message after trimming: spaces do not make a short message long enough', async () => {
		const padded = `   ${'a'.repeat(offerMessageMinLength - 1)}   `;
		expect(await invalidFields(OfferInput, { ...offer, offerMessage: padded })).toEqual(['offerMessage']);
	});

	it('rejects a malformed briefId or productId', async () => {
		expect(await invalidFields(OfferInput, { ...offer, briefId: 'nope', productId: 'nope' })).toEqual([
			'briefId',
			'productId',
		]);
	});
});

describe('OfferUpdate (D-48)', () => {
	const update = { _id: new Types.ObjectId().toHexString() };

	it('needs only the id: fields left out do not change', async () => {
		expect(await invalidFields(OfferUpdate, update)).toEqual([]);
		expect(await invalidFields(OfferUpdate, {})).toEqual(['_id']);
	});

	it('applies the same rules as OfferInput to the fields it is given', async () => {
		expect(
			await invalidFields(OfferUpdate, { ...update, offerPrice: 0, offerDeliveryDays: 0, offerMessage: 'short' }),
		).toEqual(['offerDeliveryDays', 'offerMessage', 'offerPrice']);
	});
});

describe('BriefOffersInquiry (D-48)', () => {
	it('requires search.briefId, a valid id', async () => {
		expect(await invalidFields(BriefOffersInquiry, { page: 1, limit: 10, search: {} })).toEqual(['search.briefId']);
		expect(await invalidFields(BriefOffersInquiry, { page: 1, limit: 10, search: { briefId: 'x' } })).toEqual([
			'search.briefId',
		]);
	});
});
