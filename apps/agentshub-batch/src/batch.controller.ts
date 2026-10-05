import { Controller, Get, Logger } from '@nestjs/common';
import { BatchService } from './batch.service';
import { Cron, Interval, Timeout } from '@nestjs/schedule';
import { BATCH_ROLLBACK, BATCH_TOP_AGENTS, BATCH_TOP_PROPERTIES } from './libs/config';

@Controller()
export class BatchController {
	private logger: Logger = new Logger('BatchController.name');

	constructor(private readonly batchService: BatchService) {}

	/* 
	@Interval(1000)
	handleInterval() {
		this.logger.debug('Interval Test');
	}
	*/

	@Timeout(1000)
	handleTimeout() {
		this.logger.debug('BATCH SERVER READY!');
	}

	@Cron('00 00 01  * * *', { name: BATCH_ROLLBACK })
	public async batchRollback() {
		try {
			this.logger['context'] = 'BATCH_ROLLBACK';
			this.logger.debug('EXECUTED');
			await this.batchService.batchRollback();
		} catch (err) {
			this.logger.error(err);
		}
	}

	@Cron('20 00 01 * * *', { name: BATCH_TOP_PROPERTIES })
	public async batchTopProperties() {
		try {
			this.logger['context'] = 'BATCH_TOP_PROPERTIES';
			this.logger.debug('EXECUTED');
			await this.batchService.batchProperties();
		} catch (err) {
			this.logger.error(err);
		}
	}

	@Cron('40 00 01 * * *', { name: BATCH_TOP_AGENTS })
	public async batchTopAgents() {
		try {
			this.logger['context'] = 'BATCH_TOP_AGENTS';
			this.logger.debug('EXECUTED');
			await this.batchService.batchAgents();
		} catch (err) {
			this.logger.error(err);
		}
	}

	@Get()
	getHello(): string {
		return this.batchService.getHello();
	}

	/** Hammasini bittada yozish xatolikni oldini olish uchun!
	 @Cron('00 00 01 * * *', { name: BATCH_NIGHTLY_JOB })
public async runNightlyBatch() {
    try {
        await this.batchService.batchRollback();
        await this.batchService.batchProperties();
        await this.batchService.batchAgents();
    } catch (err) {
        this.logger.error(err);
    }
}
	 */
}
