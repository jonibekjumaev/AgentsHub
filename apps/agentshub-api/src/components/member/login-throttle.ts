import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { loginFailureLimit, loginFailureWindowMs, loginThrottleMaxKeys } from '../../libs/config';
import { Message } from '../../libs/enums/common.enum';

/**
 * D-51: slows down password guessing. Failed logins are counted per client address and nick (lower-cased) in a
 * sliding window; past `loginFailureLimit` the login is refused with 429 before any password check, until the oldest
 * failure leaves the window. A success clears the count. The key includes the address so a stranger can't lock a
 * member out from everywhere by failing on purpose.
 *
 * In memory, per API instance: with several instances (or behind a proxy without TRUST_PROXY) a shared store such as
 * Redis replaces it behind the same three methods.
 */
@Injectable()
export class LoginThrottle {
	private readonly failures = new Map<string, number[]>();

	/** Throws 429 TOO_MANY_LOGIN_ATTEMPTS while this address has too many recent failures on this nick. */
	public assertAllowed(address: string, memberNick: string, now: number = Date.now()): void {
		if (this.recent(this.key(address, memberNick), now).length >= loginFailureLimit) {
			throw new HttpException(Message.TOO_MANY_LOGIN_ATTEMPTS, HttpStatus.TOO_MANY_REQUESTS);
		}
	}

	public recordFailure(address: string, memberNick: string, now: number = Date.now()): void {
		const key = this.key(address, memberNick);
		const list = this.recent(key, now);
		list.push(now);
		// re-insert so Map order is "least recently failed first" for the size bound below
		this.failures.delete(key);
		this.failures.set(key, list);
		while (this.failures.size > loginThrottleMaxKeys) {
			const oldest = this.failures.keys().next().value as string;
			this.failures.delete(oldest);
		}
	}

	public recordSuccess(address: string, memberNick: string): void {
		this.failures.delete(this.key(address, memberNick));
	}

	private key(address: string, memberNick: string): string {
		return `${address}|${memberNick.trim().toLowerCase()}`;
	}

	/** The failures still inside the window (older ones are dropped from the stored list). */
	private recent(key: string, now: number): number[] {
		const list = (this.failures.get(key) ?? []).filter((time) => now - time < loginFailureWindowMs);
		if (list.length) this.failures.set(key, list);
		else this.failures.delete(key);
		return list;
	}
}
