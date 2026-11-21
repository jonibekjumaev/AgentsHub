import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import {
	briefVectorIndex,
	productVectorIndex,
	queryEmbeddingCacheSize,
	queryEmbeddingCacheTtlMs,
	queryEmbeddingTimeoutMs,
	vectorSearchCandidates,
	vectorSearchLimit,
	vectorSearchMinScore,
} from '../../libs/config';
import { EmbeddingKind } from '../../libs/enums/embedding.enum';
import type { ObjectId, T } from '../../libs/types/common';
import { EmbeddingProvider } from './embedding.provider';
import { normalizeQuery } from './embedding-text';

type CachedVector = { vector: number[]; expiresAt: number };

/**
 * D-52: the semantic half of a text search. `rankedIds` turns the search text into a query vector and asks the
 * collection's Atlas vectorSearch index for the closest documents, best first. The lists use those ids as a filter (with
 * their other filters on top) and as the order of "relevance".
 *
 * It never fails a search: without a provider, past queryEmbeddingTimeoutMs, without the index (local or e2e MongoDB)
 * or on any other error it answers null, and the list falls back to the keyword search it had before D-52.
 */
@Injectable()
export class VectorSearchService {
	private readonly cache = new Map<string, CachedVector>();
	private readonly models: Record<EmbeddingKind, { model: Model<unknown>; index: string }>;
	private warned = false;

	constructor(
		@InjectModel('Product') productModel: Model<unknown>,
		@InjectModel('Brief') briefModel: Model<unknown>,
		private readonly provider: EmbeddingProvider,
	) {
		this.models = {
			[EmbeddingKind.PRODUCT]: { model: productModel, index: productVectorIndex },
			[EmbeddingKind.BRIEF]: { model: briefModel, index: briefVectorIndex },
		};
	}

	/**
	 * The ids of the documents closest in meaning to `text` (at most vectorSearchLimit, each scoring at least
	 * vectorSearchMinScore), best first; null when semantic search can't answer. `filter` may use only the fields the
	 * index declares as filters (productStatus, briefStatus).
	 */
	public async rankedIds(kind: EmbeddingKind, text: string, filter: T): Promise<ObjectId[] | null> {
		if (!this.provider.model) return null;
		const queryVector = await this.queryVector(text);
		if (!queryVector) return null;

		const { model, index } = this.models[kind];
		const pipeline = [
			{
				$vectorSearch: {
					index,
					path: 'embedding',
					queryVector,
					numCandidates: vectorSearchCandidates,
					limit: vectorSearchLimit,
					filter,
				},
			},
			{ $project: { _id: 1, score: { $meta: 'vectorSearchScore' } } },
		] as unknown as PipelineStage[];
		try {
			const rows = await model.aggregate<{ _id: ObjectId; score: number }>(pipeline).exec();
			return rows.filter((row) => row.score >= vectorSearchMinScore).map((row) => row._id);
		} catch (err) {
			// most likely no Atlas index (a local MongoDB): say it once, not on every search
			if (!this.warned) {
				this.warned = true;
				console.log('Vector search unavailable, using keyword search:', err instanceof Error ? err.message : err);
			}
			return null;
		}
	}

	/** The query vector, from the cache when the same text (case and spacing aside) was searched recently. */
	private async queryVector(text: string): Promise<number[] | null> {
		const key = normalizeQuery(text);
		if (!key) return null;
		const now = Date.now();
		const cached = this.cache.get(key);
		if (cached && cached.expiresAt > now) {
			// re-insert: Map order is the eviction order, least recently used first
			this.cache.delete(key);
			this.cache.set(key, cached);
			return cached.vector;
		}

		let vector: number[];
		try {
			[vector] = await this.provider.embed([key], 'query', queryEmbeddingTimeoutMs);
		} catch (err) {
			console.log('Error: query embedding', err instanceof Error ? err.message : err);
			return null;
		}
		this.cache.delete(key);
		this.cache.set(key, { vector, expiresAt: now + queryEmbeddingCacheTtlMs });
		while (this.cache.size > queryEmbeddingCacheSize) this.cache.delete(this.cache.keys().next().value as string);
		return vector;
	}
}
