import { Logger } from '@nestjs/common';
import { redactSensitiveText } from './utils';

type ErrorLogger = Pick<Logger, 'error'>;

let registered: ((reason: unknown) => void) | null = null;

/**
 * Logs unhandled promise rejections instead of letting Node (15+) exit the process (B22).
 *
 * graphql-js 16 can leave a rejected promise without a handler: when one list item fails synchronously
 * (e.g. `Cannot return null for non-nullable field Member.memberBriefs`), the async fields of the other
 * items are already running, and their later rejection is never awaited. The client still gets the
 * GraphQL error; only that orphaned rejection is left. Without this handler it killed the whole API.
 *
 * Only rejections are handled: an uncaught synchronous exception keeps Node's default (exit), because
 * the process state can't be trusted after it.
 */
export const registerProcessHandlers = (logger: ErrorLogger = new Logger('Process')): (() => void) => {
	if (registered) return () => undefined;
	const onRejection = (reason: unknown) => {
		const text = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
		logger.error(`Unhandled promise rejection: ${redactSensitiveText(text)}`);
	};
	process.on('unhandledRejection', onRejection);
	registered = onRejection;
	return () => {
		process.off('unhandledRejection', onRejection);
		registered = null;
	};
};
