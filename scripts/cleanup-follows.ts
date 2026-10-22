import { Types } from 'mongoose';
import { MemberService } from '../apps/agentshub-api/src/components/member/member.service';
import { MemberStatus, MemberType } from '../apps/agentshub-api/src/libs/enums/member.enum';
import { createScriptContext, isProduction, requireEnv, runScript, ScriptError } from './script-utils';

/**
 * D-39 / D-40, for data from before the rules: removes the follows of deleted members and of admins and fixes the
 * other side's counters, with the same MemberService.removeAllFollowsOf that updateMemberByAdmin runs on delete.
 *
 *   npm run cleanup:follows             dry run: per deleted member or admin, how many follows would go
 *   npm run cleanup:follows -- --apply  removes them (back up `follows` and `members` first)
 *
 * Re-runnable: a dry run after --apply reports 0. Dev only.
 */
async function main(): Promise<void> {
	if (isProduction()) throw new ScriptError('refusing to run with NODE_ENV=production');
	const unknown = process.argv.slice(2).filter((arg) => arg !== '--apply');
	if (unknown.length) throw new ScriptError(`unknown argument(s): ${unknown.join(' ')}; only --apply is allowed`);
	const apply = process.argv.includes('--apply');
	requireEnv(['MONGODB_DEV']);

	const { app, connection } = await createScriptContext();
	try {
		console.log(`cleanup:follows: database "${connection.db?.databaseName}" on ${connection.host}`);
		console.log(`cleanup:follows: ${apply ? 'APPLY: removing follows' : 'DRY RUN: nothing is written (add --apply)'}`);

		const deleted = await connection
			.collection('members')
			.find(
				{ $or: [{ memberStatus: MemberStatus.DELETE }, { memberType: MemberType.ADMIN }] },
				{ projection: { memberNick: 1 } },
			)
			.toArray();
		const follows = connection.collection('follows');
		const memberService = app.get(MemberService);

		let total = 0;
		for (const member of deleted) {
			const id = member._id as unknown as Types.ObjectId;
			const followers = await follows.countDocuments({ followingId: id });
			const followings = await follows.countDocuments({ followerId: id });
			if (followers + followings === 0) continue;
			total += followers + followings;
			console.log(`  @${String(member.memberNick)}: ${followers} follower(s), ${followings} following(s)`);
			if (apply) await memberService.removeAllFollowsOf(id);
		}

		console.log(
			`cleanup:follows: ${deleted.length} deleted member(s) and admin(s); ${total} follow(s) ${apply ? 'removed' : 'would go'}` +
				(apply ? '. Run the dry run again: it must report 0.' : ''),
		);
	} finally {
		await app.close();
	}
}

runScript('cleanup:follows', main);
