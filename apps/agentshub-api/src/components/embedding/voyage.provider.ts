import { embeddingDimensions } from '../../libs/config';
import { DisabledEmbeddingProvider, EmbeddingInputType, EmbeddingProvider } from './embedding.provider';

type VoyageResponse = { data?: Array<{ index: number; embedding: number[] }> };

/**
 * D-52: Voyage AI text embeddings over plain HTTPS (no SDK). POST {baseUrl}/embeddings with `input`, `model`,
 * `input_type` and `output_dimension`; the answer's `data[].index` says which input each vector belongs to.
 * The API key is sent only in the Authorization header and never logged.
 */
export class VoyageEmbeddingProvider extends EmbeddingProvider {
	constructor(
		private readonly apiKey: string,
		readonly model: string,
		private readonly baseUrl: string,
	) {
		super();
	}

	async embed(texts: string[], inputType: EmbeddingInputType, timeoutMs: number): Promise<number[][]> {
		if (!texts.length) return [];
		const response = await fetch(`${this.baseUrl}/embeddings`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify({
				input: texts,
				model: this.model,
				input_type: inputType,
				output_dimension: embeddingDimensions,
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) {
			// the body explains the refusal (bad key, rate limit); cut, so a huge page can't flood the log
			const detail = (await response.text().catch(() => '')).slice(0, 300);
			throw new Error(`Voyage ${response.status}: ${detail}`);
		}

		const body = (await response.json()) as VoyageResponse;
		const vectors: number[][] = new Array<number[]>(texts.length);
		for (const item of body.data ?? []) vectors[item.index] = item.embedding;
		for (let i = 0; i < texts.length; i++) {
			if (vectors[i]?.length !== embeddingDimensions)
				throw new Error(`Voyage: no ${embeddingDimensions}-d vector for input ${i}`);
		}
		return vectors;
	}
}

/**
 * The provider the app runs with: Voyage when VOYAGE_API_KEY is set (EMBEDDING_MODEL, default voyage-4-lite;
 * VOYAGE_BASE_URL, default the Voyage API — Atlas model API keys use https://ai.mongodb.com/v1), else disabled.
 */
export const embeddingProviderFromEnv = (env: NodeJS.ProcessEnv = process.env): EmbeddingProvider => {
	const apiKey = env.VOYAGE_API_KEY?.trim();
	if (!apiKey) {
		console.log('Embeddings: VOYAGE_API_KEY is not set, semantic search is off (D-52)');
		return new DisabledEmbeddingProvider();
	}
	const model = env.EMBEDDING_MODEL?.trim() || 'voyage-4-lite';
	const baseUrl = (env.VOYAGE_BASE_URL?.trim() || 'https://api.voyageai.com/v1').replace(/\/+$/, '');
	return new VoyageEmbeddingProvider(apiKey, model, baseUrl);
};
