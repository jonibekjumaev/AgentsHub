import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, Model } from 'mongoose';
import { embeddingBatchSize, embeddingMaxAttempts, embeddingTimeoutMs } from '../../libs/config';
import { EmbeddingKind, EmbeddingStatus } from '../../libs/enums/embedding.enum';
import { ProductStatus } from '../../libs/enums/product.enum';
import { BriefStatus } from '../../libs/enums/brief.enum';
import { describeDbError } from '../../libs/utils';
import type { ObjectId, T } from '../../libs/types/common';
import { EmbeddingProvider } from './embedding.provider';
import {
	briefEmbeddingText,
	BriefTextFields,
	briefTextKeys,
	embeddingHash,
	productEmbeddingText,
	ProductTextFields,
	productTextKeys,
} from './embedding-text';

/** What the sync reads of a document: its text fields and where its vector stands. */
type EmbeddableDoc = T & {
	_id: ObjectId;
	embeddingStatus?: EmbeddingStatus;
	embeddingModel?: string;
	embeddingHash?: string;
};

type Spec = {
	model: Model<EmbeddableDoc>;
	keys: readonly string[];
	text: (doc: EmbeddableDoc) => string;
	/** documents that never need a vector: deleted ones are listed nowhere */
	live: T;
};

export type SyncReport = { embedded: number; unchanged: number; failed: number };

const emptyReport = (): SyncReport => ({ embedded: 0, unchanged: 0, failed: 0 });

/**
 * D-52: keeps each product's and brief's `embedding` in step with its text. It is called for one document right after
 * a create or a text change (EmbeddingQueue, in the background), and by the reconcile job for everything not READY
 * (new documents, failures, documents from before D-52, a changed model).
 *
 * - The same text is never sent twice: a document whose text hash and model match its stored vector is only marked
 *   READY.
 * - Every write is compare-and-set on the text fields that were read: if the text changed while the provider was
 *   answering, the old vector is not written over the new text (the document stays PENDING for its own sync).
 * - Writes don't touch updatedAt (`timestamps: false`): a vector is not an edit.
 * - Without a provider (no API key) nothing changes: documents stay PENDING until one is configured.
 */
@Injectable()
export class EmbeddingSyncService {
	private readonly specs: Record<EmbeddingKind, Spec>;

	constructor(
		@InjectModel('Product') productModel: Model<EmbeddableDoc>,
		@InjectModel('Brief') briefModel: Model<EmbeddableDoc>,
		private readonly provider: EmbeddingProvider,
	) {
		this.specs = {
			[EmbeddingKind.PRODUCT]: {
				model: productModel,
				keys: productTextKeys,
				text: (doc) => productEmbeddingText(doc as unknown as ProductTextFields),
				live: { productStatus: { $ne: ProductStatus.DELETE } },
			},
			[EmbeddingKind.BRIEF]: {
				model: briefModel,
				keys: briefTextKeys,
				text: (doc) => briefEmbeddingText(doc as unknown as BriefTextFields),
				live: { briefStatus: { $ne: BriefStatus.DELETE } },
			},
		};
	}

	/** One document, right after it was created or its text changed. */
	public async syncOne(kind: EmbeddingKind, id: ObjectId): Promise<SyncReport> {
		const spec = this.specs[kind];
		const doc = await spec.model
			.findOne({ _id: id, ...spec.live }, this.projection(spec))
			.lean<EmbeddableDoc>()
			.exec();
		return doc ? await this.embedDocuments(kind, [doc]) : emptyReport();
	}

	/**
	 * The reconcile job: every live document without a current vector (not READY, or made by another model), in _id
	 * order, one pass, at most `maxDocuments` per kind. Documents that failed embeddingMaxAttempts times are left until
	 * their text changes. A batch the provider refuses stops that kind: the next run tries again.
	 */
	public async syncPending(maxDocuments = 1_000): Promise<Record<EmbeddingKind, SyncReport>> {
		const reports = { [EmbeddingKind.PRODUCT]: emptyReport(), [EmbeddingKind.BRIEF]: emptyReport() };
		const model = this.provider.model;
		if (!model) return reports;

		for (const kind of Object.values(EmbeddingKind)) {
			const spec = this.specs[kind];
			let lastId: ObjectId | null = null;
			let seen = 0;
			while (seen < maxDocuments) {
				const docs = await spec.model
					.find(
						{
							...spec.live,
							...(lastId ? { _id: { $gt: lastId } } : {}),
							embeddingAttempts: { $not: { $gte: embeddingMaxAttempts } },
							$or: [{ embeddingStatus: { $ne: EmbeddingStatus.READY } }, { embeddingModel: { $ne: model } }],
						},
						this.projection(spec),
					)
					.sort({ _id: 1 })
					.limit(Math.min(embeddingBatchSize, maxDocuments - seen))
					.lean<EmbeddableDoc[]>()
					.exec();
				if (!docs.length) break;

				const report = await this.embedDocuments(kind, docs);
				reports[kind].embedded += report.embedded;
				reports[kind].unchanged += report.unchanged;
				reports[kind].failed += report.failed;

				seen += docs.length;
				lastId = docs[docs.length - 1]._id;
				if (report.failed && !report.embedded) break; // the provider is refusing: don't hammer it
				if (docs.length < embeddingBatchSize) break;
			}
		}
		return reports;
	}

	private async embedDocuments(kind: EmbeddingKind, docs: EmbeddableDoc[]): Promise<SyncReport> {
		const report = emptyReport();
		const model = this.provider.model;
		if (!model) return report;
		const spec = this.specs[kind];

		const items = docs.map((doc) => {
			const text = spec.text(doc);
			return { doc, text, hash: embeddingHash(text) };
		});

		// the vector already matches this text: nothing to send, only the status may need to catch up
		const current = items.filter((item) => item.hash === item.doc.embeddingHash && item.doc.embeddingModel === model);
		const stale = current.filter((item) => item.doc.embeddingStatus !== EmbeddingStatus.READY);
		if (stale.length) {
			await spec.model.bulkWrite(
				stale.map((item): AnyBulkWriteOperation<EmbeddableDoc> => ({
					updateOne: {
						filter: this.sameTextFilter(spec, item.doc),
						update: { $set: { embeddingStatus: EmbeddingStatus.READY, embeddingAttempts: 0 } },
						timestamps: false,
					},
				})),
			);
		}
		report.unchanged += current.length;

		const toEmbed = items.filter((item) => !current.includes(item));
		for (let start = 0; start < toEmbed.length; start += embeddingBatchSize) {
			const batch = toEmbed.slice(start, start + embeddingBatchSize);
			let vectors: number[][];
			try {
				vectors = await this.provider.embed(
					batch.map((item) => item.text),
					'document',
					embeddingTimeoutMs,
				);
			} catch (err) {
				console.log(`Error: embedding ${kind}`, err instanceof Error ? err.message : err);
				await spec.model
					.updateMany(
						{ _id: { $in: batch.map((item) => item.doc._id) } },
						{ $set: { embeddingStatus: EmbeddingStatus.FAILED }, $inc: { embeddingAttempts: 1 } },
						{ timestamps: false },
					)
					.exec();
				report.failed += batch.length;
				continue;
			}

			const embeddedAt = new Date();
			try {
				await spec.model.bulkWrite(
					batch.map((item, index): AnyBulkWriteOperation<EmbeddableDoc> => ({
						updateOne: {
							filter: this.sameTextFilter(spec, item.doc),
							update: {
								$set: {
									embedding: vectors[index],
									embeddingHash: item.hash,
									embeddingModel: model,
									embeddingStatus: EmbeddingStatus.READY,
									embeddingAttempts: 0,
									embeddedAt,
								},
							},
							timestamps: false,
						},
					})),
				);
				report.embedded += batch.length;
			} catch (err) {
				// the vectors are lost, the documents stay as they were: the reconcile job tries them again
				console.log(`Error: saving ${kind} embeddings`, describeDbError(err));
				report.failed += batch.length;
			}
		}
		return report;
	}

	/** The document, only while its text fields are still what was read (a missing field is matched as missing). */
	private sameTextFilter(spec: Spec, doc: EmbeddableDoc): T {
		const filter: T = { _id: doc._id };
		for (const key of spec.keys) filter[key] = (doc[key] as unknown) ?? null;
		return filter;
	}

	private projection(spec: Spec): T {
		const projection: T = { embeddingStatus: 1, embeddingModel: 1, embeddingHash: 1 };
		for (const key of spec.keys) projection[key] = 1;
		return projection;
	}
}
