import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { DatabaseModule } from '../apps/agentshub-batch/src/database/database.module';
import {
	collectReferences,
	findOrphans,
	orphanMinAgeMs,
	scannedUploadDirs,
	UploadFile,
} from '../apps/agentshub-batch/src/maintenance/orphan-uploads';
import { createScriptContext, isProduction, requireEnv, runScript, ScriptError } from './script-utils';

/**
 * Step 13a item 9 (D-36): deletes uploaded images that no member, product or article references and that are
 * older than 24 h. Run it from the repo root, on the machine whose uploads/ folder the API serves.
 *
 *   npm run clean:uploads             dry run: lists the orphans and their total size, deletes nothing
 *   npm run clean:uploads -- --apply  deletes them
 *
 * Allowed in production too (it reads MONGODB_PROD there); the database it reads is printed first.
 */
@Module({ imports: [ConfigModule.forRoot(), DatabaseModule] })
class CleanUploadsModule {}

async function listFiles(dir: string): Promise<UploadFile[]> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return []; // the folder doesn't exist on this machine yet
	}
	const files: UploadFile[] = [];
	for (const name of names) {
		const path = `${dir}/${name}`;
		const info = await stat(join(process.cwd(), path));
		if (info.isFile()) files.push({ path, mtimeMs: info.mtimeMs, size: info.size });
	}
	return files;
}

async function main(): Promise<void> {
	const unknown = process.argv.slice(2).filter((arg) => arg !== '--apply');
	if (unknown.length) throw new ScriptError(`unknown argument(s): ${unknown.join(' ')}; only --apply is allowed`);
	const apply = process.argv.includes('--apply');
	requireEnv([isProduction() ? 'MONGODB_PROD' : 'MONGODB_DEV']);

	const { app, connection } = await createScriptContext(CleanUploadsModule);
	try {
		console.log(`clean:uploads: database "${connection.db?.databaseName}" on ${connection.host}`);
		console.log(`clean:uploads: ${apply ? 'APPLY: deleting orphans' : 'DRY RUN: nothing is deleted (add --apply)'}`);

		// every document, whatever its status: a paused product or a blocked member may come back
		const [members, products, boardArticles] = await Promise.all([
			connection
				.collection('members')
				.find({}, { projection: { memberImage: 1 } })
				.toArray(),
			connection
				.collection('products')
				.find({}, { projection: { productImages: 1 } })
				.toArray(),
			connection
				.collection('boardArticles')
				.find({}, { projection: { articleImage: 1 } })
				.toArray(),
		]);
		const references = collectReferences({
			members: members as { memberImage?: unknown }[],
			products: products as { productImages?: unknown }[],
			boardArticles: boardArticles as { articleImage?: unknown }[],
		});

		const files = (await Promise.all(scannedUploadDirs.map(listFiles))).flat();
		const orphans = findOrphans(files, references, Date.now());
		const bytes = orphans.reduce((sum, file) => sum + file.size, 0);

		console.log(
			`clean:uploads: ${files.length} file(s) in ${scannedUploadDirs.join(', ')}; ${references.size} referenced; ` +
				`${orphans.length} orphan(s) older than ${orphanMinAgeMs / 3_600_000} h, ${(bytes / 1_048_576).toFixed(1)} MB`,
		);
		for (const file of orphans) console.log(`  ${apply ? 'delete' : 'would delete'} ${file.path}`);

		if (apply) {
			let deleted = 0;
			for (const file of orphans) {
				await unlink(join(process.cwd(), file.path)).then(
					() => (deleted += 1),
					(err: unknown) => console.log(`  could not delete ${file.path}: ${String(err)}`),
				);
			}
			console.log(`clean:uploads: deleted ${deleted} file(s)`);
		}
	} finally {
		await app.close();
	}
}

runScript('clean:uploads', main);
