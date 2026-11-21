import { EventEmitter2 } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import { EmbeddingKind } from '../../libs/enums/embedding.enum';
import { EMBEDDING_SYNC_EVENT, EmbeddingQueue } from './embedding-queue';
import { EmbeddingSyncService } from './embedding-sync.service';

describe('EmbeddingQueue (D-52)', () => {
	const id = new Types.ObjectId();

	it('requestSync only emits: the caller does not wait for the provider', () => {
		const events = { emit: jest.fn() };
		const sync = { syncOne: jest.fn() };
		const queue = new EmbeddingQueue(events as unknown as EventEmitter2, sync as unknown as EmbeddingSyncService);

		queue.requestSync(EmbeddingKind.PRODUCT, id);

		expect(events.emit).toHaveBeenCalledWith(EMBEDDING_SYNC_EVENT, { kind: EmbeddingKind.PRODUCT, id });
		expect(sync.syncOne).not.toHaveBeenCalled();
	});

	it('the listener syncs the document, and a failure is logged, never thrown', async () => {
		const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
		const sync = { syncOne: jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue({}) };
		const queue = new EmbeddingQueue({} as EventEmitter2, sync as unknown as EmbeddingSyncService);

		await expect(queue.onSyncRequested({ kind: EmbeddingKind.BRIEF, id })).resolves.toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith('Error: EmbeddingQueue', 'db down');
		await queue.onSyncRequested({ kind: EmbeddingKind.BRIEF, id });
		expect(sync.syncOne).toHaveBeenLastCalledWith(EmbeddingKind.BRIEF, id);
		logSpy.mockRestore();
	});
});
