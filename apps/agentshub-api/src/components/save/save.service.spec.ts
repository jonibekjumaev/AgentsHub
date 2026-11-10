import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { expectHttpError } from '../../../test/utils/http-error';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { BriefStatus } from '../../libs/enums/brief.enum';
import { Message } from '../../libs/enums/common.enum';
import { SaveService } from './save.service';

const memberId = new Types.ObjectId();
const briefId = new Types.ObjectId();

describe('SaveService (D-47)', () => {
	let service: SaveService;
	let saveModel: MockModel;

	beforeEach(async () => {
		saveModel = createMockModel();
		const moduleRef = await Test.createTestingModule({
			providers: [SaveService, { provide: getModelToken('Save'), useValue: saveModel }],
		}).compile();
		service = moduleRef.get(SaveService);
	});

	describe('saveBrief: idempotent', () => {
		it('upserts the { memberId, briefId } pair, so a second save changes nothing', async () => {
			await service.saveBrief(memberId, briefId);

			expect(saveModel.updateOne).toHaveBeenCalledWith(
				{ memberId, briefId },
				{ $setOnInsert: { memberId, briefId } },
				{ upsert: true },
			);
		});

		it('a duplicate key from a parallel save is not an error: the save exists either way', async () => {
			saveModel.reject('updateOne', Object.assign(new Error('E11000'), { code: 11000 }));

			await expect(service.saveBrief(memberId, briefId)).resolves.toBeUndefined();
		});

		it('any other database error → BAD_REQUEST CREATE_FAILED', async () => {
			saveModel.reject('updateOne', new Error('connection lost'));

			await expectHttpError(service.saveBrief(memberId, briefId), BadRequestException, Message.CREATE_FAILED);
		});
	});

	it('unsaveBrief deletes the pair; nothing to delete is no error (idempotent)', async () => {
		await expect(service.unsaveBrief(memberId, briefId)).resolves.toBeUndefined();

		expect(saveModel.deleteOne).toHaveBeenCalledWith({ memberId, briefId });
	});

	it('isBriefSaved checks the pair', async () => {
		saveModel.resolve('exists', { _id: new Types.ObjectId() });

		await expect(service.isBriefSaved(memberId, briefId)).resolves.toBe(true);
		await expect(service.isBriefSaved(memberId, briefId)).resolves.toBe(false);
		expect(saveModel.exists).toHaveBeenCalledWith({ memberId, briefId });
	});

	it("removeSavesOfBrief removes every member's save of the brief", async () => {
		saveModel.resolve('deleteMany', { deletedCount: 2 });

		await expect(service.removeSavesOfBrief(briefId)).resolves.toBe(2);
		expect(saveModel.deleteMany).toHaveBeenCalledWith({ briefId });
	});

	describe('getSavedBriefs', () => {
		const pipeline = () => saveModel.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;

		it("lists the caller's saves, latest saved first, OPEN and CLOSED briefs only (D-30), before paging", async () => {
			saveModel.resolve('aggregate', [{ list: [], metaCounter: [] }]);
			await service.getSavedBriefs(memberId, { page: 2, limit: 5 });

			const stages = pipeline();
			expect(stages[0]).toEqual({ $match: { memberId } });
			expect(stages[1]).toEqual({ $sort: { createdAt: -1, _id: -1 } });
			// the status filter comes before $facet, so metaCounter counts the same briefs the list shows
			const statusIndex = stages.findIndex((stage) => 'savedBrief.briefStatus' in ((stage.$match as object) ?? {}));
			const facetIndex = stages.findIndex((stage) => '$facet' in stage);
			expect(stages[statusIndex]).toEqual({
				$match: { 'savedBrief.briefStatus': { $in: [BriefStatus.OPEN, BriefStatus.CLOSED] } },
			});
			expect(statusIndex).toBeLessThan(facetIndex);
			const list = (stages[facetIndex].$facet as { list: object[] }).list;
			expect(list.slice(0, 2)).toEqual([{ $skip: 5 }, { $limit: 5 }]);
		});

		it('returns the briefs themselves, each with meSaved: true', async () => {
			const brief = { _id: briefId, briefTitle: 'Support bot', briefStatus: BriefStatus.CLOSED };
			saveModel.resolve('aggregate', [{ list: [{ savedBrief: brief }], metaCounter: [{ total: 1 }] }]);

			await expect(service.getSavedBriefs(memberId, { page: 1, limit: 10 })).resolves.toEqual({
				list: [{ ...brief, meSaved: true }],
				metaCounter: [{ total: 1 }],
			});
		});
	});
});
