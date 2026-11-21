import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../apps/agentshub-api/src/database/database.module';
import { briefVectorIndex, embeddingDimensions, productVectorIndex } from '../apps/agentshub-api/src/libs/config';
import { createScriptContext, isProduction, requireEnv, runScript } from './script-utils';

/**
 * D-52: creates (or updates) the Atlas vectorSearch indexes the semantic search needs. Run once per cluster, and again
 * after a change below. Works in production too (it only adds indexes): `npm run create-search-indexes`. Atlas builds
 * an index in the background; until it is READY, searches fall back to keywords.
 *
 * Only Atlas (or an Atlas CLI local deployment) has search indexes: a plain MongoDB refuses the command.
 */
@Module({ imports: [ConfigModule.forRoot(), DatabaseModule] })
class IndexScriptModule {}

type IndexSpec = { collection: string; name: string; filters: string[] };

/** Each `filters` field can be used in $vectorSearch's filter; add a field here before filtering on it. */
const indexes: IndexSpec[] = [
	{ collection: 'products', name: productVectorIndex, filters: ['productStatus'] },
	{ collection: 'briefs', name: briefVectorIndex, filters: ['briefStatus'] },
];

const definitionOf = (spec: IndexSpec) => ({
	fields: [
		{ type: 'vector', path: 'embedding', numDimensions: embeddingDimensions, similarity: 'cosine' },
		...spec.filters.map((path) => ({ type: 'filter', path })),
	],
});

async function main(): Promise<void> {
	requireEnv([isProduction() ? 'MONGODB_PROD' : 'MONGODB_DEV']);
	const { app, connection } = await createScriptContext(IndexScriptModule);
	try {
		console.log(`create-search-indexes: database "${connection.db?.databaseName}"`);
		for (const spec of indexes) {
			const collection = connection.collection(spec.collection);
			const definition = definitionOf(spec);
			const existing = await collection.listSearchIndexes(spec.name).toArray();
			if (existing.length) {
				await collection.updateSearchIndex(spec.name, definition);
				console.log(`create-search-indexes: ${spec.collection}.${spec.name} updated`);
			} else {
				await collection.createSearchIndex({ name: spec.name, type: 'vectorSearch', definition });
				console.log(`create-search-indexes: ${spec.collection}.${spec.name} created`);
			}
		}
		console.log('create-search-indexes: Atlas builds them in the background (Atlas → Search & Vector Search to watch)');
	} finally {
		await app.close();
	}
}

runScript('create-search-indexes', main);
