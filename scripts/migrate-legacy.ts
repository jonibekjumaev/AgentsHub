import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnyBulkWriteOperation } from 'mongodb';
import { DatabaseModule } from '../apps/agentshub-batch/src/database/database.module';
import {
	addToReport,
	emptyReport,
	legacyCollections,
	planFix,
	toUpdate,
} from '../apps/agentshub-batch/src/maintenance/legacy-data';
import { createScriptContext, isProduction, requireEnv, runScript, ScriptError } from './script-utils';

/**
 * Step 13a (B22, D-34): brings Nestar-era documents to the AgentsHub schema.
 *
 *   npm run migrate:legacy             dry run: prints per collection and per rule how many documents would change
 *   npm run migrate:legacy -- --apply  writes the changes (back up the collections first)
 *
 * Re-runnable: a second dry run after --apply reports 0 to change. Problems (a missing title, an unknown enum
 * value) are listed by _id and never written; fix those by hand. Dev only.
 */
@Module({ imports: [ConfigModule.forRoot(), DatabaseModule] })
class MigrateLegacyModule {}

async function main(): Promise<void> {
	if (isProduction()) throw new ScriptError('refusing to run with NODE_ENV=production');
	const unknown = process.argv.slice(2).filter((arg) => arg !== '--apply');
	if (unknown.length) throw new ScriptError(`unknown argument(s): ${unknown.join(' ')}; only --apply is allowed`);
	const apply = process.argv.includes('--apply');
	requireEnv(['MONGODB_DEV']);

	const { app, connection } = await createScriptContext(MigrateLegacyModule);
	try {
		// the name and host only, never the URI (it holds the password)
		console.log(`migrate:legacy: database "${connection.db?.databaseName}" on ${connection.host}`);
		console.log(`migrate:legacy: ${apply ? 'APPLY: writing changes' : 'DRY RUN: nothing is written (add --apply)'}`);

		let total = 0;
		for (const name of legacyCollections) {
			const collection = connection.collection(name);
			const report = emptyReport(name);
			const operations: AnyBulkWriteOperation[] = [];

			for await (const doc of collection.find({})) {
				const fix = planFix(name, doc);
				addToReport(report, doc, fix);
				const update = toUpdate(fix);
				if (update) operations.push({ updateOne: { filter: { _id: doc._id }, update } });
			}

			console.log(`\n${name}: ${report.scanned} scanned, ${report.toChange} to change`);
			for (const [rule, count] of Object.entries(report.byRule)) console.log(`  ${count} × ${rule}`);
			for (const problem of report.problems) {
				console.log(`  PROBLEM ${problem._id}: ${problem.problems.join('; ')} (fix by hand)`);
			}

			if (apply && operations.length) {
				const result = await collection.bulkWrite(operations, { ordered: false });
				console.log(`  written: ${result.modifiedCount} modified`);
			}
			total += report.toChange;
		}

		console.log(
			`\nmigrate:legacy: ${total} document(s) ${apply ? 'changed' : 'would change'}` +
				(apply ? '. Run the dry run again: it must report 0.' : ''),
		);
	} finally {
		await app.close();
	}
}

runScript('migrate:legacy', main);
