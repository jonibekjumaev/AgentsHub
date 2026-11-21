import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Connection } from 'mongoose';
import { BatchJobsModule } from '../apps/agentshub-batch/src/batch-jobs.module';
import { BatchService } from '../apps/agentshub-batch/src/batch.service';
import { EmbeddingSyncService } from '../apps/agentshub-api/src/components/embedding/embedding-sync.service';
import { DatabaseModule } from '../apps/agentshub-batch/src/database/database.module';
import { createScriptContext, isProduction, requireEnv, runScript, ScriptError } from './script-utils';

/**
 * Dev only: runs the batch ranking jobs once by hand, without the scheduler (no crons start), to check them
 * in Compass. Usage: `npm run batch:run -- rollback | products | creators | offers | embeddings | all` (default: all:
 * the nightly ranking order, then the offer expiry, D-48). `embeddings` (D-52, not part of all) embeds everything without
 * a current vector, the backfill, in one go (up to 100 000 documents per collection); it needs VOYAGE_API_KEY.
 */
@Module({
	imports: [ConfigModule.forRoot(), DatabaseModule, BatchJobsModule],
})
class BatchScriptModule {}

const jobs = ['rollback', 'products', 'creators', 'offers', 'embeddings', 'all'] as const;
type Job = (typeof jobs)[number];

async function printTop(connection: Connection): Promise<void> {
	const products = await connection
		.collection('products')
		.find({ productStatus: { $ne: 'DELETE' } })
		.sort({ productRank: -1, _id: -1 })
		.limit(5)
		.project({ _id: 0, productTitle: 1, productStatus: 1, productRank: 1, productLikes: 1, productViews: 1 })
		.toArray();
	console.log('batch:run: top 5 products by productRank');
	console.table(products);

	const creators = await connection
		.collection('members')
		.find({ memberType: 'CREATOR' })
		.sort({ memberRank: -1, _id: -1 })
		.limit(5)
		.project({ _id: 0, memberNick: 1, memberStatus: 1, memberRank: 1, memberLikes: 1, memberViews: 1 })
		.toArray();
	console.log('batch:run: top 5 creators by memberRank');
	console.table(creators);
}

async function main(): Promise<void> {
	if (isProduction()) throw new ScriptError('refusing to run with NODE_ENV=production');
	const job = (process.argv[2] ?? 'all') as Job;
	if (!jobs.includes(job)) throw new ScriptError(`unknown job "${job}"; use one of: ${jobs.join(', ')}`);
	requireEnv(['MONGODB_DEV']);

	const { app, connection } = await createScriptContext(BatchScriptModule);
	try {
		console.log(`batch:run: database "${connection.db?.databaseName}", job "${job}"`);
		const batchService = app.get(BatchService);

		if (job === 'rollback' || job === 'all') {
			const reset = await batchService.batchRollback();
			console.log(
				`batch:run: rollback set ${reset.products} products and ${reset.members} members to 0 (ranks already 0 not counted)`,
			);
		}
		if (job === 'products' || job === 'all') {
			console.log(`batch:run: ranked ${await batchService.batchProducts()} products`);
		}
		if (job === 'creators' || job === 'all') {
			console.log(`batch:run: ranked ${await batchService.batchCreators()} creators`);
		}
		if (job === 'offers' || job === 'all') {
			console.log(`batch:run: expired ${await batchService.expireOffers()} offers (D-48)`);
		}
		if (job === 'embeddings') {
			const reports = await app.get(EmbeddingSyncService).syncPending(100_000);
			console.log('batch:run: embeddings (D-52)');
			console.table(reports);
			return;
		}

		await printTop(connection);
	} finally {
		await app.close();
	}
}

runScript('batch:run', main);
