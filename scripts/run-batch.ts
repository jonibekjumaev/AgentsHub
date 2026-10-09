import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Connection } from 'mongoose';
import { BatchJobsModule } from '../apps/agentshub-batch/src/batch-jobs.module';
import { BatchService } from '../apps/agentshub-batch/src/batch.service';
import { DatabaseModule } from '../apps/agentshub-batch/src/database/database.module';
import { createScriptContext, isProduction, requireEnv, runScript, ScriptError } from './script-utils';

/**
 * Dev only: runs the batch ranking jobs once by hand, without the scheduler (no crons start), to check them
 * in Compass. Usage: `npm run batch:run -- rollback | products | creators | all` (default: all, in the nightly order).
 */
@Module({
	imports: [ConfigModule.forRoot(), DatabaseModule, BatchJobsModule],
})
class BatchScriptModule {}

const jobs = ['rollback', 'products', 'creators', 'all'] as const;
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
			console.log(`batch:run: ranked ${await batchService.batchAgents()} creators`);
		}

		await printTop(connection);
	} finally {
		await app.close();
	}
}

runScript('batch:run', main);
