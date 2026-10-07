import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Connection } from 'mongoose';
import { ScriptsModule } from './scripts.module';

/** An error whose message is shown as is, without a stack (missing keys, refused runs, invalid input). */
export class ScriptError extends Error {}

export const isProduction = (): boolean => process.env.NODE_ENV === 'production';

/** Returns the trimmed values of the keys, or throws one error naming every missing key. */
export function requireEnv<K extends string>(keys: readonly K[]): Record<K, string> {
	const missing = keys.filter((key) => !process.env[key]?.trim());
	if (missing.length) throw new ScriptError(`Missing keys in .env: ${missing.join(', ')} (see .env.example)`);
	return Object.fromEntries(keys.map((key) => [key, process.env[key]!.trim()])) as Record<K, string>;
}

/**
 * The API's ValidationPipe runs only on GraphQL requests, not on service calls, so scripts check their input
 * against the same DTO first. `skip` names properties the script sets on purpose (e.g. memberType ADMIN).
 * Messages are the DTO's own; class-validator's messages don't echo the value, so passwords never reach the log.
 */
export async function validated<T extends object>(
	cls: ClassConstructor<T>,
	plain: object,
	skip: string[] = [],
): Promise<T> {
	const instance = plainToInstance(cls, plain);
	const errors = (await validate(instance)).filter((error) => !skip.includes(error.property));
	if (errors.length) {
		const details = errors.map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`);
		throw new ScriptError(`Invalid ${cls.name}: ${details.join('; ')}`);
	}
	return instance;
}

export async function createScriptContext(): Promise<{ app: INestApplicationContext; connection: Connection }> {
	const app = await NestFactory.createApplicationContext(ScriptsModule, { logger: ['error', 'warn'] });
	const connection = app.get<Connection>(getConnectionToken());
	return { app, connection };
}

/** Runs a script's main(): ScriptError → its message only, anything else → the full error; exit code 1. */
export function runScript(name: string, main: () => Promise<void>): void {
	main().then(
		() => process.exit(0),
		(err: unknown) => {
			console.error(`${name} failed: ${err instanceof ScriptError ? err.message : String(err)}`);
			if (!(err instanceof ScriptError) && err instanceof Error) console.error(err.stack);
			process.exit(1);
		},
	);
}
