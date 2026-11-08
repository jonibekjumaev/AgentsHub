import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { profileVisitorsWindowDays } from '../../libs/config';
import { MemberType } from '../../libs/enums/member.enum';
import { ViewGroup } from '../../libs/enums/view.enum';
import { ViewService } from './view.service';

const memberId = new Types.ObjectId();
const profileId = new Types.ObjectId();
const viewInput = { memberId, viewRefId: profileId, viewGroup: ViewGroup.MEMBER };

describe('ViewService', () => {
	let service: ViewService;
	let viewModel: MockModel;

	beforeEach(async () => {
		viewModel = createMockModel();
		const moduleRef = await Test.createTestingModule({
			providers: [ViewService, { provide: getModelToken('View'), useValue: viewModel }],
		}).compile();
		service = moduleRef.get(ViewService);
	});

	describe('recordView (B24, D-42)', () => {
		it('upserts on memberId + viewRefId and reports a first view', async () => {
			viewModel.resolve('updateOne', { upsertedCount: 1, matchedCount: 0 });

			await expect(service.recordView(viewInput, MemberType.USER)).resolves.toBe(true);
			expect(viewModel.updateOne).toHaveBeenCalledWith(
				{ memberId, viewRefId: profileId },
				{ $setOnInsert: { viewGroup: ViewGroup.MEMBER } },
				{ upsert: true },
			);
			expect(viewModel.create).not.toHaveBeenCalled();
		});

		it('a repeat view only refreshes the view: not a first view, so no counter change', async () => {
			viewModel.resolve('updateOne', { upsertedCount: 0, matchedCount: 1 });

			await expect(service.recordView(viewInput, MemberType.CREATOR)).resolves.toBe(false);
		});

		it('a parallel first view that loses the unique-index race counts as a repeat view', async () => {
			viewModel.reject('updateOne', Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

			await expect(service.recordView(viewInput, MemberType.USER)).resolves.toBe(false);
		});

		it('other database errors are not swallowed', async () => {
			const error = new Error('connection lost');
			viewModel.reject('updateOne', error);

			await expect(service.recordView(viewInput, MemberType.USER)).rejects.toBe(error);
		});

		it("never records an ADMIN's view", async () => {
			await expect(service.recordView(viewInput, MemberType.ADMIN)).resolves.toBe(false);
			expect(viewModel.updateOne).not.toHaveBeenCalled();
		});
	});

	describe('getProfileVisitors (D-42)', () => {
		const now = new Date('2026-11-07T12:00:00.000Z');
		const visit = { _id: new Types.ObjectId(), visitor: { _id: memberId, memberNick: 'aria' }, visitedAt: now };

		type Stage = Record<string, unknown>;
		type Facet = Record<'list' | 'metaCounter' | 'privateCounter', Stage[]>;
		const pipeline = () => viewModel.aggregate.mock.calls[0][0] as Stage[];
		const facet = () => (pipeline().find((stage) => stage.$facet) as { $facet: Facet }).$facet;
		const lookupStage = () =>
			(pipeline().find((stage) => stage.$lookup) as { $lookup: { pipeline: Stage[] } & Stage }).$lookup;

		it('returns the page, the total and the private count', async () => {
			viewModel.resolve('aggregate', [{ list: [visit], metaCounter: [{ total: 1 }], privateCounter: [{ total: 3 }] }]);

			await expect(service.getProfileVisitors(profileId, { page: 1, limit: 10 }, now)).resolves.toEqual({
				list: [visit],
				metaCounter: [{ total: 1 }],
				privateCount: 3,
			});
		});

		it('privateCount is 0 when nobody browsed privately', async () => {
			viewModel.resolve('aggregate', [{ list: [], metaCounter: [], privateCounter: [] }]);

			await expect(service.getProfileVisitors(profileId, { page: 1, limit: 10 }, now)).resolves.toMatchObject({
				privateCount: 0,
			});
		});

		it(`matches this profile's views of the last ${profileVisitorsWindowDays} days, latest first`, async () => {
			viewModel.resolve('aggregate', [{ list: [], metaCounter: [], privateCounter: [] }]);
			await service.getProfileVisitors(profileId, { page: 2, limit: 5 }, now);

			const since = new Date(now.getTime() - profileVisitorsWindowDays * 24 * 60 * 60 * 1000);
			expect(pipeline()[0]).toEqual({
				$match: { viewRefId: profileId, viewGroup: ViewGroup.MEMBER, updatedAt: { $gte: since } },
			});
			expect(pipeline()[1]).toEqual({ $sort: { updatedAt: -1, _id: -1 } });
		});

		it('drops deleted visitors (D-38) and admins, never returns the password hash', async () => {
			viewModel.resolve('aggregate', [{ list: [], metaCounter: [], privateCounter: [] }]);
			await service.getProfileVisitors(profileId, { page: 1, limit: 10 }, now);

			const lookup = lookupStage();
			expect(lookup).toMatchObject({ from: 'members', localField: 'memberId', as: 'visitor' });
			expect(lookup.pipeline).toEqual([
				{ $match: { memberStatus: { $ne: 'DELETE' } } },
				{ $project: { memberPassword: 0 } },
			]);
			expect(pipeline()).toContainEqual({ $unwind: '$visitor' });
			expect(pipeline()).toContainEqual({ $match: { 'visitor.memberType': { $ne: MemberType.ADMIN } } });
		});

		it('lists and counts only public visitors; private ones only go into privateCount', async () => {
			viewModel.resolve('aggregate', [{ list: [], metaCounter: [], privateCounter: [] }]);
			await service.getProfileVisitors(profileId, { page: 3, limit: 4 }, now);

			const publicOnly = { $match: { 'visitor.memberBrowsePrivately': { $ne: true } } };
			expect(facet().list).toEqual([
				publicOnly,
				{ $skip: 8 },
				{ $limit: 4 },
				{ $project: { _id: 1, visitor: 1, visitedAt: '$updatedAt' } },
			]);
			expect(facet().metaCounter).toEqual([publicOnly, { $count: 'total' }]);
			expect(facet().privateCounter).toEqual([
				{ $match: { 'visitor.memberBrowsePrivately': true } },
				{ $count: 'total' },
			]);
		});
	});
});
