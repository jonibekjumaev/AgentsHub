import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Types } from 'mongoose';
import { AuthGuard } from '../auth/guards/auth.guard';
import { MemberResolver } from './member.resolver';
import { MemberService } from './member.service';

describe('MemberResolver.getMe (D-33)', () => {
	it('is behind AuthGuard: guests get UNAUTHENTICATED, blocked members FORBIDDEN (B17)', () => {
		const guards = Reflect.getMetadata(
			GUARDS_METADATA,
			Object.getOwnPropertyDescriptor(MemberResolver.prototype, 'getMe')!.value as object,
		) as unknown[];

		expect(guards).toEqual([AuthGuard]);
	});

	it("asks the service for the token's member only", async () => {
		const memberId = new Types.ObjectId();
		const member = { _id: memberId, memberNick: 'alice' };
		const memberService = { getMe: jest.fn().mockResolvedValue(member) };
		const resolver = new MemberResolver(memberService as unknown as MemberService);
		jest.spyOn(console, 'log').mockImplementation(() => undefined);

		await expect(resolver.getMe(memberId)).resolves.toBe(member);
		expect(memberService.getMe).toHaveBeenCalledWith(memberId);
	});
});
