import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BatchService } from './batch.service';
import MemberSchema from '../../agentshub-api/src/schemas/Member.model';
import ProductSchema from '../../agentshub-api/src/schemas/Product.model';
import OfferSchema from '../../agentshub-api/src/schemas/Offer.model';
import BriefSchema from '../../agentshub-api/src/schemas/Brief.model';
import { EmbeddingSyncService } from '../../agentshub-api/src/components/embedding/embedding-sync.service';
import { embeddingProvider } from '../../agentshub-api/src/components/embedding/embedding.module';

/**
 * The ranking, offer-expiry and embedding (D-52) jobs without the scheduler: used by AgentsHubBatchModule (crons) and by `npm run batch:run`
 * (scripts/run-batch.ts), which runs a job once by hand.
 */
@Module({
	imports: [
		MongooseModule.forFeature([{ name: 'Product', schema: ProductSchema }]),
		MongooseModule.forFeature([{ name: 'Member', schema: MemberSchema }]),
		MongooseModule.forFeature([
			{ name: 'Offer', schema: OfferSchema },
			{ name: 'Brief', schema: BriefSchema },
		]),
	],
	providers: [BatchService, embeddingProvider, EmbeddingSyncService],
	exports: [BatchService, EmbeddingSyncService],
})
export class BatchJobsModule {}
