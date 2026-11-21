import { Controller, Get, Logger } from '@nestjs/common';
import { BatchService } from './batch.service';
import { Cron, Timeout } from '@nestjs/schedule';
import { EmbeddingSyncService } from '../../agentshub-api/src/components/embedding/embedding-sync.service';
import {
	BATCH_EMBEDDINGS,
	BATCH_EXPIRE_OFFERS,
	BATCH_NIGHTLY_JOB,
	BATCH_ROLLBACK,
	BATCH_TOP_CREATORS,
	BATCH_TOP_PRODUCTS,
} from './libs/config';

@Controller()
export class BatchController {
	private logger: Logger = new Logger(BatchController.name);

	private embeddingsRunning = false;

	constructor(
		private readonly batchService: BatchService,
		private readonly embeddingSync: EmbeddingSyncService,
	) {}

	@Timeout(1000)
	handleTimeout() {
		this.logger.debug('BATCH SERVER READY!');
	}

	/** Hammasini bittada yozish xatolikni oldini olish uchun!
	 * One job runs the steps in order, each after the previous one has finished: the ranking steps only rank
	 * documents whose rank is 0, so they must never start before the rollback is done. A failed step stops the rest.
	 */
	@Cron('00 00 01 * * *', { name: BATCH_NIGHTLY_JOB })
	public async batchNightly() {
		try {
			await this.runStep(BATCH_ROLLBACK, () => this.batchService.batchRollback());
			await this.runStep(BATCH_TOP_PRODUCTS, () => this.batchService.batchProducts());
			await this.runStep(BATCH_TOP_CREATORS, () => this.batchService.batchCreators());
		} catch {
			this.logger.error('STOPPED: a step failed, the next steps were skipped', BATCH_NIGHTLY_JOB);
		}
	}

	/**
	 * D-48: its own job, not a step of the nightly ranking: a ranking failure must not leave offers unexpired, and the
	 * other way round. Reads never depend on it (an offer past its expiry is answered as EXPIRED), so once a day is enough.
	 */
	@Cron('00 30 01 * * *', { name: BATCH_EXPIRE_OFFERS })
	public async batchExpireOffers() {
		try {
			await this.runStep(BATCH_EXPIRE_OFFERS, () => this.batchService.expireOffers());
		} catch {
			// already logged by runStep; the next run picks the offers up again
		}
	}

	/**
	 * D-52: the reconcile job. Every 5 minutes, vectors for whatever has none that matches its text: new documents whose
	 * background sync was lost, failures to retry, documents from before D-52 (the backfill), a changed model. A run
	 * that is still going when the next one is due is not started twice. Without VOYAGE_API_KEY it does nothing.
	 */
	@Cron('00 */5 * * * *', { name: BATCH_EMBEDDINGS })
	public async batchEmbeddings() {
		if (this.embeddingsRunning) return;
		this.embeddingsRunning = true;
		try {
			const reports = await this.embeddingSync.syncPending();
			const total = Object.values(reports).reduce((sum, report) => sum + report.embedded + report.failed, 0);
			if (total) this.logger.debug(JSON.stringify(reports), BATCH_EMBEDDINGS);
		} catch (err) {
			this.logger.error(err, BATCH_EMBEDDINGS);
		} finally {
			this.embeddingsRunning = false;
		}
	}

	/** Logs the step under its own context; a failure is logged there too and stops the nightly job. */
	private async runStep(context: string, step: () => Promise<unknown>): Promise<void> {
		this.logger.debug('EXECUTED', context);
		try {
			await step();
		} catch (err) {
			this.logger.error(err, context);
			throw err;
		}
	}

	@Get()
	getHello(): string {
		return this.batchService.getHello();
	}
}
