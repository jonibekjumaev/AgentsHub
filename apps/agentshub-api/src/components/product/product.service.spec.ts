import {
	BadRequestException,
	ConflictException,
	InternalServerErrorException,
	NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { expectHttpError } from '../../../test/utils/http-error';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { ProductInput } from '../../libs/dto/product/product.input';
import { ProductUpdate } from '../../libs/dto/product/product.update';
import { AgentCategory } from '../../libs/enums/agent-category.enum';
import { Direction, Message } from '../../libs/enums/common.enum';
import { LikeGroup } from '../../libs/enums/like.enum';
import { MemberType } from '../../libs/enums/member.enum';
import { ProductPricing, ProductStatus } from '../../libs/enums/product.enum';
import { ViewGroup } from '../../libs/enums/view.enum';
import { ObjectId, StatisticModifier } from '../../libs/types/common';
import { LikeService } from '../like/like.service';
import { MemberService } from '../member/member.service';
import { ViewService } from '../view/view.service';
import { ProductService } from './product.service';

const { ACTIVE, PAUSED, DELETE } = ProductStatus;
const { FREE, ONE_TIME, SUBSCRIPTION, CUSTOM } = ProductPricing;

const ownerId = new Types.ObjectId();
const otherId = new Types.ObjectId();
const adminId = new Types.ObjectId();
const productId = new Types.ObjectId();

/** What applyProductUpdate reads before it writes (status and pricing only) */
const storedProduct = (fields: object = {}) => ({
	productStatus: ACTIVE,
	productPricing: ONE_TIME,
	productPrice: 10,
	...fields,
});
/** A full product as getProduct reads it */
const fullProduct = (fields: object = {}) => ({
	_id: productId,
	memberId: ownerId,
	productViews: 3,
	...storedProduct(fields),
});

describe('ProductService', () => {
	let service: ProductService;
	let productModel: MockModel;
	let memberService: { memberStatsEditor: jest.Mock<Promise<unknown>, [StatisticModifier]>; getMember: jest.Mock };
	let viewService: { recordView: jest.Mock };
	let likeService: { checkLikeExistence: jest.Mock; toggleLike: jest.Mock };

	beforeEach(async () => {
		productModel = createMockModel();
		memberService = {
			memberStatsEditor: jest.fn<Promise<unknown>, [StatisticModifier]>().mockResolvedValue({}),
			getMember: jest.fn().mockResolvedValue({ _id: ownerId, memberNick: 'owner' }),
		};
		viewService = { recordView: jest.fn().mockResolvedValue(null) };
		likeService = { checkLikeExistence: jest.fn().mockResolvedValue([]), toggleLike: jest.fn().mockResolvedValue(1) };

		const moduleRef = await Test.createTestingModule({
			providers: [
				ProductService,
				{ provide: getModelToken('Product'), useValue: productModel },
				{ provide: MemberService, useValue: memberService },
				{ provide: ViewService, useValue: viewService },
				{ provide: LikeService, useValue: likeService },
			],
		}).compile();
		service = moduleRef.get(ProductService);
	});

	const memberProductsChanges = () =>
		memberService.memberStatsEditor.mock.calls.filter(([input]) => input.targetKey === 'memberProducts');

	describe('createProduct', () => {
		const productInput = (fields: Partial<ProductInput>): ProductInput => ({
			productCategory: AgentCategory.SALES,
			productPricing: ONE_TIME,
			productTitle: 'Lead qualifier',
			productPrice: 10,
			productImages: ['uploads/product/a.png'],
			productDesc: 'Qualifies inbound leads over Telegram.',
			memberId: ownerId,
			...fields,
		});

		beforeEach(() => {
			productModel.create.mockImplementation((input: ProductInput) => Promise.resolve({ _id: productId, ...input }));
		});

		describe('D-03: the price depends on the pricing', () => {
			it.each([
				[ONE_TIME, 10],
				[SUBSCRIPTION, 0.5],
				[FREE, undefined],
				[FREE, null],
				[CUSTOM, undefined],
				[CUSTOM, null],
			])('accepts %s with price %p', async (productPricing, productPrice) => {
				await service.createProduct(productInput({ productPricing, productPrice: productPrice as number }));

				expect(productModel.create).toHaveBeenCalledTimes(1);
			});

			it.each([
				[ONE_TIME, undefined],
				[ONE_TIME, null],
				[ONE_TIME, 0],
				[ONE_TIME, -5],
				[SUBSCRIPTION, undefined],
				[SUBSCRIPTION, null],
				[SUBSCRIPTION, 0],
				[SUBSCRIPTION, -5],
			])('rejects %s with price %p: PRICE_REQUIRED, nothing stored', async (productPricing, productPrice) => {
				const input = productInput({ productPricing, productPrice: productPrice as number });

				await expectHttpError(service.createProduct(input), BadRequestException, Message.PRICE_REQUIRED);
				expect(productModel.create).not.toHaveBeenCalled();
				expect(memberService.memberStatsEditor).not.toHaveBeenCalled();
			});

			it.each([
				[FREE, 10],
				[FREE, 0],
				[FREE, -5],
				[CUSTOM, 10],
				[CUSTOM, 0],
			])('rejects %s with price %p: PRICE_NOT_ALLOWED, nothing stored', async (productPricing, productPrice) => {
				const input = productInput({ productPricing, productPrice });

				await expectHttpError(service.createProduct(input), BadRequestException, Message.PRICE_NOT_ALLOWED);
				expect(productModel.create).not.toHaveBeenCalled();
			});

			it('stores no price field for a null price, not null', async () => {
				await service.createProduct(productInput({ productPricing: FREE, productPrice: null as unknown as number }));

				expect(productModel.create.mock.calls[0][0]).not.toHaveProperty('productPrice');
			});
		});

		it("adds 1 to the owner's memberProducts (D-16, ER rule 5)", async () => {
			await service.createProduct(productInput({}));

			expect(memberService.memberStatsEditor).toHaveBeenCalledWith({
				_id: ownerId,
				targetKey: 'memberProducts',
				modifier: 1,
			});
		});

		it('saves the tags trimmed, lowercased and without duplicates', async () => {
			await service.createProduct(productInput({ productTags: [' CRM', 'crm ', 'Telegram'] }));

			expect(productModel.create.mock.calls[0][0]).toMatchObject({ productTags: ['crm', 'telegram'] });
		});

		it('answers a duplicate title with CONFLICT USED_PRODUCT_TITLE (B15)', async () => {
			productModel.create.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));

			await expectHttpError(service.createProduct(productInput({})), ConflictException, Message.USED_PRODUCT_TITLE);
			expect(memberService.memberStatsEditor).not.toHaveBeenCalled();
		});

		it('answers any other database error with CREATE_FAILED', async () => {
			productModel.create.mockRejectedValue(new Error('connection lost'));

			await expectHttpError(service.createProduct(productInput({})), BadRequestException, Message.CREATE_FAILED);
		});

		it('passes a memberProducts failure through as a server error, not CREATE_FAILED (B20)', async () => {
			memberService.memberStatsEditor.mockRejectedValue(new InternalServerErrorException(Message.UPDATE_FAILED));

			await expectHttpError(
				service.createProduct(productInput({})),
				InternalServerErrorException,
				Message.UPDATE_FAILED,
			);
			expect(productModel.create).toHaveBeenCalledTimes(1);
		});
	});

	describe('updateProduct / updateProductByAdmin', () => {
		/** Queues the stored product and the written result, then runs the owner or admin update */
		const runUpdate = (stored: object | null, input: Partial<ProductUpdate>, by: 'owner' | 'admin' = 'owner') => {
			productModel.resolve('findOne', stored);
			productModel.resolve('findOneAndUpdate', {
				_id: productId,
				memberId: ownerId,
				productStatus: input.productStatus,
			});
			const update = { _id: productId, ...input };
			return by === 'owner' ? service.updateProduct(ownerId, update) : service.updateProductByAdmin(update);
		};
		const readFilter = () => productModel.findOne.mock.calls[0][0];
		const writeFilter = () => productModel.findOneAndUpdate.mock.calls[0][0];
		const writtenUpdate = () => productModel.findOneAndUpdate.mock.calls[0][1] as Record<string, unknown>;

		describe('who can update what (D-29)', () => {
			it('the owner update matches only their own, non-deleted product', async () => {
				await runUpdate(storedProduct(), { productTitle: 'New title' });

				expect(readFilter()).toEqual({ _id: productId, memberId: ownerId, productStatus: { $ne: DELETE } });
			});

			it("the admin update matches any member's non-deleted product", async () => {
				await runUpdate(storedProduct(), { productTitle: 'New title' }, 'admin');

				expect(readFilter()).toEqual({ _id: productId, productStatus: { $ne: DELETE } });
			});

			it.each(['owner', 'admin'] as const)(
				'a missing, foreign or deleted product answers NOT_FOUND UPDATE_FAILED for the %s',
				async (by) => {
					await expectHttpError(runUpdate(null, { productTitle: 'x' }, by), NotFoundException, Message.UPDATE_FAILED);
					expect(productModel.findOneAndUpdate).not.toHaveBeenCalled();
				},
			);
		});

		describe('status changes (D-16, D-29)', () => {
			it.each([
				[ACTIVE, PAUSED],
				[PAUSED, ACTIVE],
				[ACTIVE, ACTIVE],
				[PAUSED, PAUSED],
				[ACTIVE, undefined],
				[PAUSED, undefined],
			])('%s → %s is allowed and leaves memberProducts unchanged', async (current, next) => {
				await runUpdate(storedProduct({ productStatus: current }), { productStatus: next });

				expect(productModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
				expect(writtenUpdate()).not.toHaveProperty('deletedAt');
				expect(memberProductsChanges()).toEqual([]);
			});

			it.each([ACTIVE, PAUSED])(
				'%s → DELETE sets deletedAt and subtracts 1 from memberProducts, for the owner and the admin',
				async (current) => {
					for (const by of ['owner', 'admin'] as const) {
						productModel.findOneAndUpdate.mockClear();
						memberService.memberStatsEditor.mockClear();
						await runUpdate(storedProduct({ productStatus: current }), { productStatus: DELETE }, by);

						expect(writtenUpdate().deletedAt).toBeInstanceOf(Date);
						expect(memberService.memberStatsEditor).toHaveBeenCalledTimes(1);
						expect(memberService.memberStatsEditor).toHaveBeenCalledWith({
							_id: ownerId,
							targetKey: 'memberProducts',
							modifier: -1,
						});
					}
				},
			);

			it.each([ACTIVE, PAUSED, DELETE, undefined])('DELETE is final: DELETE → %s is rejected', (next) => {
				// unreachable through the update path, which never reads a deleted product; the table itself still refuses it
				const checkStatusChange = (current: ProductStatus, nextStatus?: ProductStatus) =>
					service['checkStatusChange'](current, nextStatus);

				if (next === DELETE || next === undefined) {
					expect(checkStatusChange(DELETE, next)).toBe(false); // same status / none: no change
				} else {
					expect(() => checkStatusChange(DELETE, next)).toThrow(Message.INVALID_PRODUCT_STATUS_CHANGE);
				}
			});
		});

		describe('compare-and-set (D-29)', () => {
			it('pins the write to the status that was read', async () => {
				await runUpdate(storedProduct({ productStatus: PAUSED }), { productStatus: ACTIVE });

				expect(writeFilter()).toEqual({ _id: productId, memberId: ownerId, productStatus: PAUSED });
			});

			it('a concurrent change (the write matches nothing) → NOT_FOUND UPDATE_FAILED, no counter change', async () => {
				productModel.resolve('findOne', storedProduct()).resolve('findOneAndUpdate', null);
				const update = { _id: productId, productStatus: DELETE } as ProductUpdate;

				await expectHttpError(service.updateProduct(ownerId, update), NotFoundException, Message.UPDATE_FAILED);
				expect(memberService.memberStatsEditor).not.toHaveBeenCalled();
			});
		});

		describe('D-03 on the final pricing/price combination', () => {
			it.each([
				['stored ONE_TIME 10, switched to FREE', storedProduct(), { productPricing: FREE }],
				[
					'stored ONE_TIME 10, switched to CUSTOM with null',
					storedProduct(),
					{ productPricing: CUSTOM, productPrice: null },
				],
				['stored FREE, only the title changes', storedProduct({ productPricing: FREE, productPrice: undefined }), {}],
			])('%s → the price is $unset, never stored as null', async (_label, stored, input) => {
				await runUpdate(stored, { productTitle: 'New title', ...input } as Partial<ProductUpdate>);

				expect(writtenUpdate()).not.toHaveProperty('productPrice');
				expect(writtenUpdate().$unset).toEqual({ productPrice: 1 });
			});

			it.each([
				[
					'stored SUBSCRIPTION 20, only the title changes',
					storedProduct({ productPricing: SUBSCRIPTION, productPrice: 20 }),
					{},
				],
				['stored ONE_TIME 10, switched to SUBSCRIPTION', storedProduct(), { productPricing: SUBSCRIPTION }],
			])('%s → the stored price is kept', async (_label, stored, input) => {
				await runUpdate(stored, { productTitle: 'New title', ...input });

				expect(writtenUpdate()).not.toHaveProperty('productPrice');
				expect(writtenUpdate()).not.toHaveProperty('$unset');
			});

			it('stored FREE, switched to ONE_TIME with a price → the new price is written', async () => {
				await runUpdate(storedProduct({ productPricing: FREE, productPrice: undefined }), {
					productPricing: ONE_TIME,
					productPrice: 30,
				});

				expect(writtenUpdate()).toMatchObject({ productPricing: ONE_TIME, productPrice: 30 });
				expect(writtenUpdate()).not.toHaveProperty('$unset');
			});

			it.each([
				[
					'stored FREE, switched to ONE_TIME without a price',
					storedProduct({ productPricing: FREE, productPrice: undefined }),
					{ productPricing: ONE_TIME },
					Message.PRICE_REQUIRED,
				],
				[
					'stored ONE_TIME 10, price cleared with null',
					storedProduct(),
					{ productPrice: null },
					Message.PRICE_REQUIRED,
				],
				['stored ONE_TIME 10, price set to 0', storedProduct(), { productPrice: 0 }, Message.PRICE_REQUIRED],
				[
					'stored FREE, a price sent alone',
					storedProduct({ productPricing: FREE, productPrice: undefined }),
					{ productPrice: 5 },
					Message.PRICE_NOT_ALLOWED,
				],
				[
					'stored ONE_TIME 10, switched to CUSTOM with a price',
					storedProduct(),
					{ productPricing: CUSTOM, productPrice: 10 },
					Message.PRICE_NOT_ALLOWED,
				],
			])('%s → BAD_REQUEST, nothing written', async (_label, stored, input, message) => {
				await expectHttpError(runUpdate(stored, input as Partial<ProductUpdate>), BadRequestException, message);
				expect(productModel.findOneAndUpdate).not.toHaveBeenCalled();
			});
		});

		it('saves the tags normalized', async () => {
			await runUpdate(storedProduct(), { productTags: ['AI ', 'ai'] });

			expect(writtenUpdate()).toMatchObject({ productTags: ['ai'] });
		});

		it('answers a duplicate title with CONFLICT USED_PRODUCT_TITLE (B15)', async () => {
			productModel.resolve('findOne', storedProduct());
			productModel.reject('findOneAndUpdate', Object.assign(new Error('E11000'), { code: 11000 }));
			const update = { _id: productId, productTitle: 'Taken' } as ProductUpdate;

			await expectHttpError(service.updateProduct(ownerId, update), ConflictException, Message.USED_PRODUCT_TITLE);
		});
	});

	describe('isProductVisible (D-16)', () => {
		const viewers: Array<[string, ObjectId | null, MemberType | null]> = [
			['a guest', null, null],
			['another member', otherId, MemberType.USER],
			['the owner', ownerId, MemberType.CREATOR],
			['an admin', adminId, MemberType.ADMIN],
		];
		const expected: Record<ProductStatus, boolean[]> = {
			[ACTIVE]: [true, true, true, true],
			[PAUSED]: [false, false, true, true],
			[DELETE]: [false, false, false, false],
		};

		it.each(Object.values(ProductStatus))('%s', (status) => {
			const product = { productStatus: status, memberId: ownerId };
			const visible = viewers.map(([, memberId, memberType]) =>
				service.isProductVisible(product, memberId, memberType),
			);

			expect(visible).toEqual(expected[status]);
		});
	});

	describe('getProduct', () => {
		it.each([
			['a guest', PAUSED, null, null],
			['another member', PAUSED, otherId, MemberType.CREATOR],
			['the owner', DELETE, ownerId, MemberType.CREATOR],
			['an admin', DELETE, adminId, MemberType.ADMIN],
		])(
			'%s gets NOT_FOUND for a %s product, like a missing one (D-16)',
			async (_label, status, memberId, memberType) => {
				productModel.resolve('findOne', fullProduct({ productStatus: status }));

				await expectHttpError(
					service.getProduct(memberId, memberType, productId),
					NotFoundException,
					Message.NO_DATA_FOUND,
				);
			},
		);

		it('a missing product → NOT_FOUND', async () => {
			await expectHttpError(service.getProduct(null, null, productId), NotFoundException, Message.NO_DATA_FOUND);
		});

		it('a guest sees an ACTIVE product, with the owner as memberData, and records no view', async () => {
			productModel.resolve('findOne', fullProduct());
			const result = await service.getProduct(null, null, productId);

			expect(result.memberData).toEqual({ _id: ownerId, memberNick: 'owner' });
			expect(viewService.recordView).not.toHaveBeenCalled();
			expect(likeService.checkLikeExistence).not.toHaveBeenCalled();
		});

		it("another member's first view is recorded and counted once", async () => {
			productModel.resolve('findOne', fullProduct()).resolve('findByIdAndUpdate', fullProduct());
			viewService.recordView.mockResolvedValue({ _id: new Types.ObjectId() });
			const result = await service.getProduct(otherId, MemberType.USER, productId);

			expect(viewService.recordView).toHaveBeenCalledWith({
				memberId: otherId,
				viewRefId: productId,
				viewGroup: ViewGroup.PRODUCT,
			});
			expect(productModel.findByIdAndUpdate).toHaveBeenCalledWith(
				productId,
				{ $inc: { productViews: 1 } },
				{ new: true },
			);
			expect(result.productViews).toBe(4);
		});

		it("another member's repeat view (already recorded) doesn't change productViews (D-18)", async () => {
			productModel.resolve('findOne', fullProduct());
			const result = await service.getProduct(otherId, MemberType.USER, productId);

			expect(productModel.findByIdAndUpdate).not.toHaveBeenCalled();
			expect(result.productViews).toBe(3);
		});

		it.each([
			['the owner of an ACTIVE product (D-22)', ACTIVE, ownerId, MemberType.CREATOR],
			['the owner of a PAUSED product (D-16)', PAUSED, ownerId, MemberType.CREATOR],
			['an admin on a PAUSED product (D-16)', PAUSED, adminId, MemberType.ADMIN],
		])('records no view for %s', async (_label, status, memberId, memberType) => {
			productModel.resolve('findOne', fullProduct({ productStatus: status }));
			await service.getProduct(memberId, memberType, productId);

			expect(viewService.recordView).not.toHaveBeenCalled();
			expect(productModel.findByIdAndUpdate).not.toHaveBeenCalled();
		});

		it('tells a logged-in member whether they liked it', async () => {
			productModel.resolve('findOne', fullProduct());
			likeService.checkLikeExistence.mockResolvedValue([{ memberId: otherId, likeRefId: productId, myFavorite: true }]);
			const result = await service.getProduct(otherId, MemberType.USER, productId);

			expect(likeService.checkLikeExistence).toHaveBeenCalledWith({
				memberId: otherId,
				likeRefId: productId,
				likeGroup: LikeGroup.PRODUCT,
			});
			expect(result.meLiked).toEqual([{ memberId: otherId, likeRefId: productId, myFavorite: true }]);
		});
	});

	describe('likeTargetProduct', () => {
		it('only an ACTIVE product can be liked (D-16): otherwise NOT_FOUND', async () => {
			await expectHttpError(service.likeTargetProduct(otherId, productId), NotFoundException, Message.NO_DATA_FOUND);

			expect(productModel.findOne).toHaveBeenCalledWith({ _id: productId, productStatus: ACTIVE });
			expect(likeService.toggleLike).not.toHaveBeenCalled();
		});

		it("the owner can't like their own product (D-22)", async () => {
			productModel.resolve('findOne', fullProduct());

			await expectHttpError(
				service.likeTargetProduct(ownerId, productId),
				BadRequestException,
				Message.NOT_ALLOWED_REQUEST,
			);
			expect(likeService.toggleLike).not.toHaveBeenCalled();
		});

		it.each([1, -1])('another member toggles the like and productLikes changes by %p', async (modifier) => {
			productModel.resolve('findOne', fullProduct()).resolve('findByIdAndUpdate', fullProduct());
			likeService.toggleLike.mockResolvedValue(modifier);
			await service.likeTargetProduct(otherId, productId);

			expect(likeService.toggleLike).toHaveBeenCalledWith({
				memberId: otherId,
				likeRefId: productId,
				likeGroup: LikeGroup.PRODUCT,
			});
			expect(productModel.findByIdAndUpdate).toHaveBeenCalledWith(
				productId,
				{ $inc: { productLikes: modifier } },
				{ new: true },
			);
		});
	});

	describe('product lists', () => {
		const inquiry = { page: 1, limit: 10, search: {} };
		const pipeline = () => productModel.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
		const match = () => pipeline()[0].$match as Record<string, unknown>;

		beforeEach(() => {
			productModel.resolve('aggregate', [{ list: [], metaCounter: [] }]);
		});

		it('getProducts lists only ACTIVE products, with the memberId filter too (D-16)', async () => {
			await service.getProducts(otherId, { ...inquiry, search: { memberId: ownerId } });

			expect(match()).toEqual({ productStatus: ACTIVE, memberId: ownerId });
		});

		it("getCreatorProducts lists the caller's ACTIVE and PAUSED products by default", async () => {
			await service.getCreatorProducts(ownerId, inquiry);

			expect(match()).toEqual({ memberId: ownerId, productStatus: { $ne: DELETE } });
		});

		it('getCreatorProducts can filter one status, but DELETE → BAD_REQUEST', async () => {
			await service.getCreatorProducts(ownerId, { ...inquiry, search: { productStatus: PAUSED } });
			expect(match()).toEqual({ memberId: ownerId, productStatus: PAUSED });

			await expectHttpError(
				service.getCreatorProducts(ownerId, { ...inquiry, search: { productStatus: DELETE } }),
				BadRequestException,
				Message.NO_DATA_FOUND,
			);
		});

		it('getAllProductsByAdmin lists every status, DELETE included, unless one is asked for', async () => {
			await service.getAllProductsByAdmin(inquiry);

			expect(match()).toEqual({});
		});

		describe('price filter (D-03)', () => {
			it('matches only ONE_TIME and SUBSCRIPTION products', async () => {
				await service.getProducts(null as unknown as ObjectId, {
					...inquiry,
					search: { pricesRange: { start: 5, end: 50 } },
				});

				expect(match()).toMatchObject({
					productPricing: { $in: [ONE_TIME, SUBSCRIPTION] },
					productPrice: { $gte: 5, $lte: 50 },
				});
			});

			it('with a pricingList, matches only its paid pricings', async () => {
				const search = { pricesRange: { start: 0, end: 50 }, pricingList: [FREE, ONE_TIME, CUSTOM] };
				await service.getProducts(null as unknown as ObjectId, { ...inquiry, search });

				expect(match().productPricing).toEqual({ $in: [ONE_TIME] });
			});

			it('start greater than end → BAD_REQUEST INVALID_PRICE_RANGE', async () => {
				const search = { pricesRange: { start: 50, end: 5 } };

				await expectHttpError(
					service.getProducts(null as unknown as ObjectId, { ...inquiry, search }),
					BadRequestException,
					Message.INVALID_PRICE_RANGE,
				);
			});

			it('sorting by price puts products without a price last, in both directions', async () => {
				await service.getProducts(null as unknown as ObjectId, {
					...inquiry,
					sort: 'productPrice',
					direction: Direction.ASC,
				});

				expect(pipeline()[1]).toEqual({ $addFields: { _hasPrice: { $cond: [{ $isNumber: '$productPrice' }, 1, 0] } } });
				expect(pipeline()[2]).toEqual({ $sort: { _hasPrice: -1, productPrice: Direction.ASC, _id: -1 } });
			});
		});

		it('normalizes tagList and escapes the text search (S8)', async () => {
			const search = { tagList: [' CRM '], text: 'a.b(' };
			await service.getProducts(null as unknown as ObjectId, { ...inquiry, search });

			expect(match().productTags).toEqual({ $all: ['crm'] });
			expect(match().productTitle).toEqual({ $regex: /a\.b\(/i });
		});
	});

	describe('removeProductByAdmin', () => {
		it('hard-deletes only a product already set to DELETE (D-28 principle)', async () => {
			productModel.resolve('findOneAndDelete', fullProduct({ productStatus: DELETE }));
			await service.removeProductByAdmin(productId);

			expect(productModel.findOneAndDelete).toHaveBeenCalledWith({ _id: productId, productStatus: DELETE });
			expect(memberService.memberStatsEditor).not.toHaveBeenCalled();
		});

		it('an ACTIVE, PAUSED or missing product → NOT_FOUND REMOVE_FAILED', async () => {
			await expectHttpError(service.removeProductByAdmin(productId), NotFoundException, Message.REMOVE_FAILED);
		});
	});
});
