/**
 * D-52: where a document's vector stands. PENDING: its search text is new or changed and no vector matches it yet
 * (also every document stored before D-52, which has no status). READY: `embedding` is the vector of the current text
 * from `embeddingModel`. FAILED: the provider refused or timed out; the reconcile job retries it up to
 * embeddingMaxAttempts times. Not exposed in GraphQL.
 */
export enum EmbeddingStatus {
	PENDING = 'PENDING',
	READY = 'READY',
	FAILED = 'FAILED',
}

/** The collections that have vectors. */
export enum EmbeddingKind {
	PRODUCT = 'PRODUCT',
	BRIEF = 'BRIEF',
}
