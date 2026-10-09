import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BatchService } from './batch.service';
import MemberSchema from '../../agentshub-api/src/schemas/Member.model';
import ProductSchema from '../../agentshub-api/src/schemas/Product.model';

/**
 * The ranking jobs without the scheduler: used by AgentsHubBatchModule (crons) and by `npm run batch:run`
 * (scripts/run-batch.ts), which runs a job once by hand.
 */
@Module({
	imports: [
		MongooseModule.forFeature([{ name: 'Product', schema: ProductSchema }]),
		MongooseModule.forFeature([{ name: 'Member', schema: MemberSchema }]),
	],
	providers: [BatchService],
	exports: [BatchService],
})
export class BatchJobsModule {}
