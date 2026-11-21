import { embeddingDimensions } from '../../libs/config';
import { DisabledEmbeddingProvider, EmbeddingUnavailableError } from './embedding.provider';
import { embeddingProviderFromEnv, VoyageEmbeddingProvider } from './voyage.provider';

const vector = (value: number) => new Array<number>(embeddingDimensions).fill(value);
const ok = (body: unknown) => ({
	ok: true,
	status: 200,
	json: () => Promise.resolve(body),
	text: () => Promise.resolve(''),
});

describe('VoyageEmbeddingProvider (D-52)', () => {
	let fetchMock: jest.Mock;

	beforeEach(() => {
		fetchMock = jest.fn();
		global.fetch = fetchMock;
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
	});

	afterEach(() => jest.restoreAllMocks());

	it('posts the texts with the model, input type and dimensions, and returns the vectors in input order', async () => {
		fetchMock.mockResolvedValue(
			ok({
				data: [
					{ index: 1, embedding: vector(2) },
					{ index: 0, embedding: vector(1) },
				],
			}),
		);
		const provider = new VoyageEmbeddingProvider('key-1', 'voyage-4-lite', 'https://api.voyageai.com/v1');

		const vectors = await provider.embed(['first', 'second'], 'document', 1000);

		expect(vectors[0][0]).toBe(1);
		expect(vectors[1][0]).toBe(2);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://api.voyageai.com/v1/embeddings');
		expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer key-1' });
		expect(JSON.parse(init.body as string)).toEqual({
			input: ['first', 'second'],
			model: 'voyage-4-lite',
			input_type: 'document',
			output_dimension: embeddingDimensions,
		});
		expect(init.signal).toBeDefined();
	});

	it('sends nothing for no texts', async () => {
		const provider = new VoyageEmbeddingProvider('k', 'm', 'u');
		await expect(provider.embed([], 'query', 1000)).resolves.toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('throws with the status and the start of the body when Voyage refuses', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 429, text: () => Promise.resolve('rate limited'.repeat(100)) });
		const provider = new VoyageEmbeddingProvider('k', 'm', 'u');
		const error = (await provider.embed(['x'], 'query', 1000).catch((err: unknown) => err)) as Error;
		expect(error.message.startsWith('Voyage 429: rate limited')).toBe(true);
		expect(error.message.length).toBeLessThanOrEqual(320);
	});

	it('throws when a vector is missing or has the wrong length', async () => {
		fetchMock.mockResolvedValue(ok({ data: [{ index: 0, embedding: [1, 2, 3] }] }));
		const provider = new VoyageEmbeddingProvider('k', 'm', 'u');
		await expect(provider.embed(['x'], 'query', 1000)).rejects.toThrow('no 1024-d vector for input 0');
	});
});

describe('embeddingProviderFromEnv', () => {
	beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
	afterEach(() => jest.restoreAllMocks());

	it('is disabled without VOYAGE_API_KEY: no model, every embed refused', async () => {
		const provider = embeddingProviderFromEnv({ VOYAGE_API_KEY: '  ' });
		expect(provider).toBeInstanceOf(DisabledEmbeddingProvider);
		expect(provider.model).toBeNull();
		await expect(provider.embed(['x'], 'query', 10)).rejects.toBeInstanceOf(EmbeddingUnavailableError);
	});

	it('uses voyage-4-lite and the Voyage API by default; EMBEDDING_MODEL and VOYAGE_BASE_URL override them', async () => {
		expect(embeddingProviderFromEnv({ VOYAGE_API_KEY: 'k' }).model).toBe('voyage-4-lite');

		const fetchMock = jest.fn().mockResolvedValue(ok({ data: [{ index: 0, embedding: vector(0) }] }));
		global.fetch = fetchMock;
		const provider = embeddingProviderFromEnv({
			VOYAGE_API_KEY: 'k',
			EMBEDDING_MODEL: 'voyage-4',
			VOYAGE_BASE_URL: 'https://ai.mongodb.com/v1/',
		});
		await provider.embed(['x'], 'query', 10);
		expect(provider.model).toBe('voyage-4');
		const [url] = fetchMock.mock.calls[0] as [string];
		expect(url).toBe('https://ai.mongodb.com/v1/embeddings');
	});
});
