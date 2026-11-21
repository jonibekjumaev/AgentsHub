import { HttpException } from '@nestjs/common';
import { loginFailureLimit, loginFailureWindowMs, loginThrottleMaxKeys } from '../../libs/config';
import { Message } from '../../libs/enums/common.enum';
import { LoginThrottle } from './login-throttle';

describe('LoginThrottle (D-51)', () => {
	const T0 = 1_000_000;

	it('refuses with 429 TOO_MANY_LOGIN_ATTEMPTS once the limit is reached, until the oldest failure leaves the window', () => {
		const throttle = new LoginThrottle();
		for (let i = 0; i < loginFailureLimit; i++) throttle.recordFailure('ip', 'alice', T0 + i);

		let error: unknown;
		try {
			throttle.assertAllowed('ip', 'alice', T0 + loginFailureLimit);
		} catch (err) {
			error = err;
		}
		expect(error).toBeInstanceOf(HttpException);
		expect((error as HttpException).getStatus()).toBe(429);
		expect((error as HttpException).message).toBe(Message.TOO_MANY_LOGIN_ATTEMPTS);

		// the first failure (T0) leaves the window: one fewer than the limit again
		expect(() => throttle.assertAllowed('ip', 'alice', T0 + loginFailureWindowMs)).not.toThrow();
	});

	it('keeps at most loginThrottleMaxKeys keys, forgetting the least recently failed', () => {
		const throttle = new LoginThrottle();
		for (let i = 0; i <= loginThrottleMaxKeys; i++) throttle.recordFailure(`ip${i}`, 'x', T0);
		const size = (throttle as unknown as { failures: Map<string, number[]> }).failures.size;
		expect(size).toBe(loginThrottleMaxKeys);
	});
});
