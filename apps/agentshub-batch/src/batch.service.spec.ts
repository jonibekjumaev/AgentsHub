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
				{ $set: { productRank: 0 }, $unset: { productRankPosition: '' } },
			);
		});

		it('resets memberRank of every creator, whatever the status', async () => {
			productModel.resolve('updateMany', { modifiedCount: 0 });
			memberModel.resolve('updateMany', { modifiedCount: 0 });
			await service.batchRollback();

			expect(memberModel.updateMany).toHaveBeenCalledWith(
				{ memberType: MemberType.CREATOR },
				{ $set: { memberRank: 0 }, $unset: { memberRankPosition: '' } },
			);
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

	describe('rank positions (Step 13a item 5): 1, 2, 3… of the ranked documents, in list order', () => {
		const positions = (model: MockModel, key: string) =>
			model.updateOne.mock.calls.map(([filter, update]) => [
				String((filter as { _id: unknown })._id),
				(update as { $set: Record<string, number> }).$set[key],
			]);

		it('products: reads ranked ACTIVE products by productRank DESC, _id DESC and numbers them from 1', async () => {
			const [a, b, c] = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
			productModel.resolve('find', []).resolve('find', [{ _id: b }, { _id: a }, { _id: c }]);

			await service.batchProducts();

			expect(productModel.find).toHaveBeenLastCalledWith({
				productStatus: ProductStatus.ACTIVE,
				productRank: { $gt: 0 },
			});
			const query = productModel.find.mock.results[1].value as { sort: jest.Mock };
			expect(query.sort).toHaveBeenCalledWith({ productRank: -1, _id: -1 });
			expect(positions(productModel, 'productRankPosition')).toEqual([
				[String(b), 1],
				[String(a), 2],
				[String(c), 3],
			]);
		});

		it('creators: only ACTIVE creators with memberRank > 0 get a memberRankPosition', async () => {
			const a = new Types.ObjectId();
			memberModel.resolve('find', []).resolve('find', [{ _id: a }]);

			await service.batchCreators();

			expect(memberModel.find).toHaveBeenLastCalledWith({
				memberType: MemberType.CREATOR,
				memberStatus: MemberStatus.ACTIVE,
				memberRank: { $gt: 0 },
			});
			expect(positions(memberModel, 'memberRankPosition')).toEqual([[String(a), 1]]);
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
