import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type { ObjectId } from '../../libs/types/common';
import { EmbeddingKind } from '../../libs/enums/embedding.enum';
import { EmbeddingSyncService } from './embedding-sync.service';

export const EMBEDDING_SYNC_EVENT = 'embedding.sync';

type SyncRequest = { kind: EmbeddingKind; id: ObjectId };

/**
 * D-52: how a create or a text change asks for a new vector without waiting for it. `requestSync` only emits an
 * event and returns; the listener runs after the request has answered (async listener), calls the provider and writes.
 * A failure is logged: the document stays PENDING or FAILED and the reconcile job (batch) picks it up, so nothing is
 * lost if the API process stops in between.
 */
@Injectable()
export class EmbeddingQueue {
	constructor(
		private readonly events: EventEmitter2,
		private readonly sync: EmbeddingSyncService,
	) {}

	public requestSync(kind: EmbeddingKind, id: ObjectId): void {
		this.events.emit(EMBEDDING_SYNC_EVENT, { kind, id } satisfies SyncRequest);
	}

	@OnEvent(EMBEDDING_SYNC_EVENT, { async: true })
	public async onSyncRequested(request: SyncRequest): Promise<void> {
		try {
			await this.sync.syncOne(request.kind, request.id);
		} catch (err) {
			console.log('Error: EmbeddingQueue', err instanceof Error ? err.message : err);
		}
	}
}
