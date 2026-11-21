import type { EmbeddingQueue } from '../../src/components/embedding/embedding-queue';
import type { HybridSearchService } from '../../src/components/embedding/hybrid-search.service';

/** D-52: the embedding side of ProductService / BriefService specs. The ranked (hybrid, D-53) search answers null (title match) by default. */
export type EmbeddingMocks = {
	embeddingQueue: { requestSync: jest.Mock } & Partial<EmbeddingQueue>;
	hybridSearch: { rankedIds: jest.Mock } & Partial<HybridSearchService>;
};

export const createEmbeddingMocks = (): EmbeddingMocks => ({
	embeddingQueue: { requestSync: jest.fn() },
	hybridSearch: { rankedIds: jest.fn().mockResolvedValue(null) },
});
