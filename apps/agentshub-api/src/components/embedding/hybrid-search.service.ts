import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { keywordSearchLimit, rankFusionK } from '../../libs/config';
import { EmbeddingKind } from '../../libs/enums/embedding.enum';
import type { ObjectId, T } from '../../libs/types/common';
import { VectorSearchService } from './vector-search.service';

/**
 * `$text` reads `"…"` as a phrase and a leading `-` as "must not contain". A search box is plain words, so both are
 * turned into spaces; a hyphen inside a word ("e-commerce") is left to the tokenizer.
 */
export const keywordQuery = (text: string): string =>
	text
		.replace(/"/g, ' ')
		.replace(/(^|\s)-+/g, '$1')
		.trim();

/**
 * Reciprocal Rank Fusion: each list gives a document 1 / (k + rank), rank from 1; the sums decide the order. Only the
 * positions count, so a cosine score and a textScore never have to be compared. Ties keep the first list's order.
 */
export const fuseRankings = (lists: ObjectId[][], k = rankFusionK): ObjectId[] => {
	const scores = new Map<string, { id: ObjectId; score: number; order: number }>();
	let order = 0;
	for (const list of lists) {
		list.forEach((id, index) => {
			const key = String(id);
			const entry = scores.get(key) ?? { id, score: 0, order: order++ };
			entry.score += 1 / (k + index + 1);
			scores.set(key, entry);
		});
	}
	return [...scores.values()].sort((a, b) => b.score - a.score || a.order - b.order).map((entry) => entry.id);
};

/**
 * D-53: the ranked ids of a text search, from two sides at once:
 * - meaning: VectorSearchService (Atlas $vectorSearch, D-52);
 * - words: MongoDB's own text index ($text with textScore; the schemas declare it with field weights).
 * The two lists are fused with RRF. Atlas Search ($search) is not used: the Free cluster allows 3 search/vector indexes
 * in all, and the two vector indexes already take two of them. A text index is an ordinary index, so it has no such
 * limit, and it also works on the local and e2e MongoDB.
 *
 * Either side may be missing (no provider or vector index; no text index yet): the other one ranks alone. null only
 * when neither can answer, and the lists fall back to the title match they had before D-52.
 */
@Injectable()
export class HybridSearchService {
	private readonly models: Record<EmbeddingKind, Model<unknown>>;
	private warned = false;

	constructor(
		@InjectModel('Product') productModel: Model<unknown>,
		@InjectModel('Brief') briefModel: Model<unknown>,
		private readonly vectorSearch: VectorSearchService,
	) {
		this.models = { [EmbeddingKind.PRODUCT]: productModel, [EmbeddingKind.BRIEF]: briefModel };
	}

	/**
	 * The fused ids for `text`, best first; null when neither side can answer. `filter` must suit both sides: only the
	 * fields the vector index declares as filters (productStatus, briefStatus).
	 */
	public async rankedIds(kind: EmbeddingKind, text: string, filter: T): Promise<ObjectId[] | null> {
		const [semantic, keyword] = await Promise.all([
			this.vectorSearch.rankedIds(kind, text, filter),
			this.keywordIds(kind, text, filter),
		]);
		const lists = [semantic, keyword].filter((list): list is ObjectId[] => list !== null);
		if (!lists.length) return null;
		return fuseRankings(lists);
	}

	/** The documents whose indexed words match `text`, best textScore first; null without a usable query or index. */
	private async keywordIds(kind: EmbeddingKind, text: string, filter: T): Promise<ObjectId[] | null> {
		const query = keywordQuery(text);
		if (!query) return null;
		try {
			const rows = await this.models[kind]
				.find({ ...filter, $text: { $search: query } }, { _id: 1, score: { $meta: 'textScore' } })
				.sort({ score: { $meta: 'textScore' } })
				.limit(keywordSearchLimit)
				.lean<{ _id: ObjectId }[]>()
				.exec();
			return rows.map((row) => row._id);
		} catch (err) {
			// most likely the text index is still being built: say it once, not on every search
			if (!this.warned) {
				this.warned = true;
				console.log('Keyword search unavailable:', err instanceof Error ? err.message : err);
			}
			return null;
		}
	}
}
