import { Controller, Get, Logger } from '@nestjs/common';
import { BatchService } from './batch.service';
import { Cron, Timeout } from '@nestjs/schedule';
import { BATCH_NIGHTLY_JOB, BATCH_ROLLBACK, BATCH_TOP_CREATORS, BATCH_TOP_PRODUCTS } from './libs/config';

@Controller()
export class BatchController {
	private logger: Logger = new Logger(BatchController.name);

	constructor(private readonly batchService: BatchService) {}

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
