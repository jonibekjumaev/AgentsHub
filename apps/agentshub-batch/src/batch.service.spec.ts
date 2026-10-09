import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { createMockModel, MockModel } from '../../agentshub-api/test/utils/mock-model';
import { MemberStatus, MemberType } from '../../agentshub-api/src/libs/enums/member.enum';
import { ProductStatus } from '../../agentshub-api/src/libs/enums/product.enum';
import { BatchService } from './batch.service';

describe('BatchService', () => {
	let service: BatchService;
	let productModel: MockModel;
	let memberModel: MockModel;

	beforeEach(async () => {
		productModel = createMockModel();
		memberModel = createMockModel();
		const moduleRef = await Test.createTestingModule({
			providers: [
				BatchService,
				{ provide: getModelToken('Product'), useValue: productModel },
				{ provide: getModelToken('Member'), useValue: memberModel },
			],
		}).compile();
		service = moduleRef.get(BatchService);
	});

	/** The { _id → rank } pairs a job wrote with findByIdAndUpdate */
	const writtenRanks = (model: MockModel, rankKey: string) =>
		model.findByIdAndUpdate.mock.calls.map(([_id, update]) => [
			String(_id),
			(update as Record<string, number>)[rankKey],
		]);

	describe('batchRollback', () => {
		it('resets productRank of every non-deleted product, PAUSED included (D-16)', async () => {
			productModel.resolve('updateMany', { modifiedCount: 7 });
			memberModel.resolve('updateMany', { modifiedCount: 2 });

			await expect(service.batchRollback()).resolves.toEqual({ products: 7, members: 2 });
			expect(productModel.updateMany).toHaveBeenCalledWith(
				{ productStatus: { $ne: ProductStatus.DELETE } },
				{ productRank: 0 },
			);
		});

		it('resets memberRank of every creator, whatever the status', async () => {
			productModel.resolve('updateMany', { modifiedCount: 0 });
			memberModel.resolve('updateMany', { modifiedCount: 0 });
			await service.batchRollback();

			expect(memberModel.updateMany).toHaveBeenCalledWith({ memberType: MemberType.CREATOR }, { memberRank: 0 });
		});
	});

	describe('batchProducts (D-17): likes * 2 + views, never comments', () => {
		it('ranks only ACTIVE products that are not ranked yet', async () => {
			productModel.resolve('find', []);
			await service.batchProducts();

			expect(productModel.find).toHaveBeenCalledWith({ productStatus: ProductStatus.ACTIVE, productRank: 0 });
		});

		it('writes likes * 2 + views for each product; comments change nothing', async () => {
			const a = new Types.ObjectId();
			const b = new Types.ObjectId();
			productModel.resolve('find', [
				{ _id: a, productLikes: 3, productViews: 10, productComments: 0 },
				{ _id: b, productLikes: 3, productViews: 10, productComments: 500 },
			]);

			await expect(service.batchProducts()).resolves.toBe(2);
			expect(writtenRanks(productModel, 'productRank')).toEqual([
				[String(a), 16],
				[String(b), 16],
			]);
		});
	});

	describe('batchCreators (D-22): likes * 2 + views received, never their own post counts', () => {
		it('ranks only ACTIVE creators that are not ranked yet', async () => {
			memberModel.resolve('find', []);
			await service.batchCreators();

			expect(memberModel.find).toHaveBeenCalledWith({
				memberType: MemberType.CREATOR,
				memberStatus: MemberStatus.ACTIVE,
				memberRank: 0,
			});
		});

		it('writes memberLikes * 2 + memberViews; memberProducts and memberArticles change nothing', async () => {
			const a = new Types.ObjectId();
			const b = new Types.ObjectId();
			memberModel.resolve('find', [
				{ _id: a, memberLikes: 4, memberViews: 7, memberProducts: 0, memberArticles: 0 },
				{ _id: b, memberLikes: 4, memberViews: 7, memberProducts: 40, memberArticles: 90 },
			]);

			await expect(service.batchCreators()).resolves.toBe(2);
			expect(writtenRanks(memberModel, 'memberRank')).toEqual([
				[String(a), 15],
				[String(b), 15],
			]);
		});
	});
});
