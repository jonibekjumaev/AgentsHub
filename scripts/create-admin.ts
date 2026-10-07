import { INestApplicationContext } from '@nestjs/common';
import { Connection } from 'mongoose';
import { MemberService } from '../apps/agentshub-api/src/components/member/member.service';
import { MemberInput } from '../apps/agentshub-api/src/libs/dto/member/member.input';
import { MemberType } from '../apps/agentshub-api/src/libs/enums/member.enum';
import { createScriptContext, isProduction, requireEnv, runScript, ScriptError, validated } from './script-utils';

/**
 * D-14: the only way to create an admin. Creates ADMIN_NICK if no member has that nick yet; an existing admin is
 * never changed, reset or deleted. Allowed in production (NODE_ENV=production uses MONGODB_PROD).
 * Returns the nick and whether it was created.
 */
export async function createAdminIfMissing(
	app: INestApplicationContext,
	connection: Connection,
): Promise<{ nick: string; created: boolean }> {
	const env = requireEnv(['ADMIN_NICK', 'ADMIN_PASSWORD', 'ADMIN_PHONE'] as const);

	const existing = await connection
		.collection('members')
		.findOne({ memberNick: env.ADMIN_NICK }, { projection: { memberType: 1 } });
	if (existing) {
		if (existing.memberType !== MemberType.ADMIN) {
			throw new ScriptError(
				`ADMIN_NICK "${env.ADMIN_NICK}" belongs to a ${existing.memberType} member; choose another nick`,
			);
		}
		return { nick: env.ADMIN_NICK, created: false };
	}

	// the signup rules (nick length, D-25 phone, D-26 password); memberType is the one rule an admin skips (D-14)
	const input = await validated(
		MemberInput,
		{ memberNick: env.ADMIN_NICK, memberPassword: env.ADMIN_PASSWORD, memberPhone: env.ADMIN_PHONE },
		['memberType'],
	);
	input.memberType = MemberType.ADMIN;

	// signup hashes the password like every other member (AuthService.hashPassword)
	await app.get(MemberService).signup(input);
	return { nick: env.ADMIN_NICK, created: true };
}

async function main(): Promise<void> {
	requireEnv(['ADMIN_NICK', 'ADMIN_PASSWORD', 'ADMIN_PHONE', isProduction() ? 'MONGODB_PROD' : 'MONGODB_DEV']);

	const { app, connection } = await createScriptContext();
	try {
		console.log(
			`create-admin: database "${connection.db?.databaseName}" (${isProduction() ? 'production' : 'development'})`,
		);
		const { nick, created } = await createAdminIfMissing(app, connection);
		console.log(
			created ? `create-admin: admin "${nick}" created` : `create-admin: admin "${nick}" already exists, unchanged`,
		);
	} finally {
		await app.close();
	}
}

if (require.main === module) runScript('create-admin', main);
