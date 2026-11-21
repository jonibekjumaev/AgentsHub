/** `document` for stored texts, `query` for what a member types: the provider tunes the vector for each side. */
export type EmbeddingInputType = 'document' | 'query';

/** No provider is configured (no API key): nothing is embedded and every search falls back to keywords. */
export class EmbeddingUnavailableError extends Error {
	constructor() {
		super('No embedding provider is configured');
	}
}

/**
 * D-52: turns texts into vectors. An abstract class so it can be a Nest injection token (like MemberPublisher):
 * VoyageEmbeddingProvider is the implementation, DisabledEmbeddingProvider stands in without an API key, and specs
 * use a fake. Swapping providers is one class; documents of another model are re-embedded by the reconcile job.
 */
export abstract class EmbeddingProvider {
	/** The model written to embeddingModel; null when disabled. */
	abstract readonly model: string | null;

	/** One vector per text, in the same order. Throws on any failure: callers decide what a failure means. */
	abstract embed(texts: string[], inputType: EmbeddingInputType, timeoutMs: number): Promise<number[][]>;
}

export class DisabledEmbeddingProvider extends EmbeddingProvider {
	readonly model = null;

	embed(): Promise<number[][]> {
		return Promise.reject(new EmbeddingUnavailableError());
	}
}
