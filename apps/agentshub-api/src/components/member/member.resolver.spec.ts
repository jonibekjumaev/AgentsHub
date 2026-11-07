import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { AuthService } from '../auth/auth.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MemberType } from '../../libs/enums/member.enum';
import type { Member } from '../../libs/dto/member/member';
import { MemberContactResolver } from './member-contact.resolver';
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

const guardsOf = (method: string) =>
	Reflect.getMetadata(
		GUARDS_METADATA,
		Object.getOwnPropertyDescriptor(MemberResolver.prototype, method)!.value as object,
	) as unknown[];

describe('MemberResolver.getProfileVisitors (D-42)', () => {
	it('is for members with a public profile only: USER and CREATOR, not ADMIN', () => {
		const handler = Object.getOwnPropertyDescriptor(MemberResolver.prototype, 'getProfileVisitors')!.value as object;

		expect(guardsOf('getProfileVisitors')).toEqual([RolesGuard]);
		expect(Reflect.getMetadata('roles', handler)).toEqual([MemberType.USER, MemberType.CREATOR]);
	});

	it("asks for the token's own profile, never one from the input", async () => {
		const memberId = new Types.ObjectId();
		const page = { list: [], metaCounter: [], privateCount: 0 };
		const memberService = { getProfileVisitors: jest.fn().mockResolvedValue(page) };
		const resolver = new MemberResolver(memberService as unknown as MemberService);
		jest.spyOn(console, 'log').mockImplementation(() => undefined);

		await expect(resolver.getProfileVisitors({ page: 1, limit: 10 }, memberId)).resolves.toBe(page);
		expect(memberService.getProfileVisitors).toHaveBeenCalledWith(memberId, { page: 1, limit: 10 });
	});
});

describe('MemberContactResolver.memberBrowsePrivately (D-42)', () => {
	const ownerId = new Types.ObjectId();
	const member = { _id: ownerId, memberBrowsePrivately: true } as Member;
	const request = (authorization?: string) => ({ headers: { authorization } }) as Request;
	const resolverFor = (viewerId: Types.ObjectId | null) => {
		const authService = {
			authenticate: jest.fn(() =>
				viewerId
					? Promise.resolve({ _id: viewerId, memberType: MemberType.USER, memberNick: 'viewer' })
					: Promise.reject(new Error('no token')),
			),
		};
		jest.spyOn(console, 'info').mockImplementation(() => undefined);
		return new MemberContactResolver(authService as unknown as AuthService);
	};

	it('the member themself gets the value (false when never set)', async () => {
		await expect(resolverFor(ownerId).memberBrowsePrivately(member, request('Bearer t'))).resolves.toBe(true);
		await expect(
			resolverFor(ownerId).memberBrowsePrivately({ _id: ownerId } as Member, request('Bearer t')),
		).resolves.toBe(false);
	});

	it('another member and a guest get null: nobody can tell who browses privately', async () => {
		await expect(
			resolverFor(new Types.ObjectId()).memberBrowsePrivately(member, request('Bearer t')),
		).resolves.toBeNull();
		await expect(resolverFor(null).memberBrowsePrivately(member, request())).resolves.toBeNull();
	});
});
