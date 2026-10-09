import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Types } from 'mongoose';
import { expectHttpError } from '../../../../test/utils/http-error';
import { Message } from '../../../libs/enums/common.enum';
import { MemberType } from '../../../libs/enums/member.enum';
import { AuthPayload } from '../../../libs/types/common';
import { AuthService } from '../auth.service';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { WithoutGuard } from './without.guard';

const creator: AuthPayload = { _id: new Types.ObjectId(), memberType: MemberType.CREATOR, memberNick: 'alice' };

type Request = { headers: { authorization?: string }; body: Record<string, unknown> };

/** A GraphQL execution context around `req`; `roles` is what @Roles(...) would set on the resolver method */
const graphqlContext = (req: Request, roles?: string[]): ExecutionContext => {
	const handler = () => undefined;
	if (roles) Reflect.defineMetadata('roles', roles, handler);
	const context = new ExecutionContextHost([{}, {}, { req }, {}], undefined, handler);
	context.setType('graphql');
	return context;
};
const request = (authorization?: string): Request => ({ headers: { authorization }, body: {} });

describe('auth guards (B17)', () => {
	let authService: { authenticate: jest.Mock<Promise<AuthPayload>, [string | undefined]> };

	beforeEach(() => {
		authService = { authenticate: jest.fn<Promise<AuthPayload>, [string | undefined]>().mockResolvedValue(creator) };
	});

	describe('AuthGuard: login required', () => {
		const guard = () => new AuthGuard(authService as unknown as AuthService);

		it('puts the authenticated member on req.body.authMember', async () => {
			const req = request('Bearer token');

			await expect(guard().canActivate(graphqlContext(req))).resolves.toBe(true);
			expect(authService.authenticate).toHaveBeenCalledWith('Bearer token');
			expect(req.body.authMember).toEqual(creator);
		});

		it.each([
			['a missing token', new UnauthorizedException(Message.TOKEN_NOT_EXIST)],
			['an invalid token or a deleted member', new UnauthorizedException(Message.NOT_AUTHENTICATED)],
			['a blocked member', new ForbiddenException(Message.BLOCKED_USER)],
		])('passes the authenticate error through for %s', async (_label, error) => {
			authService.authenticate.mockRejectedValue(error);
			const req = request('Bearer token');

			await expectHttpError(guard().canActivate(graphqlContext(req)), error.constructor as never, error.message);
			expect(req.body.authMember).toBeUndefined();
		});

		it('refuses a context that is not GraphQL', async () => {
			const context = new ExecutionContextHost([request('Bearer token'), {}, () => undefined]);
			context.setType('http');

			await expect(guard().canActivate(context)).resolves.toBe(false);
		});
	});

	describe('RolesGuard: login and one of the @Roles required', () => {
		const guard = () => new RolesGuard(new Reflector(), authService as unknown as AuthService);

		it('lets a member with an allowed role through, with authMember set', async () => {
			const req = request('Bearer token');

			await expect(guard().canActivate(graphqlContext(req, [MemberType.CREATOR]))).resolves.toBe(true);
			expect(req.body.authMember).toEqual(creator);
		});

		it('rejects another role with 403 ONLY_SPECIFIC_ROLES_ALLOWED, and sets no authMember', async () => {
			const req = request('Bearer token');

			await expectHttpError(
				guard().canActivate(graphqlContext(req, [MemberType.USER])),
				ForbiddenException,
				Message.ONLY_SPECIFIC_ROLES_ALLOWED,
			);
			expect(req.body.authMember).toBeUndefined();
		});

		it('authenticates before the role check: a blocked member gets BLOCKED_USER, not the role error', async () => {
			authService.authenticate.mockRejectedValue(new ForbiddenException(Message.BLOCKED_USER));

			await expectHttpError(
				guard().canActivate(graphqlContext(request('Bearer token'), [MemberType.USER])),
				ForbiddenException,
				Message.BLOCKED_USER,
			);
		});

		it('a method without @Roles is not restricted, and needs no token', async () => {
			await expect(guard().canActivate(graphqlContext(request()))).resolves.toBe(true);
			expect(authService.authenticate).not.toHaveBeenCalled();
		});
	});

	describe('WithoutGuard: login optional', () => {
		const guard = () => new WithoutGuard(authService as unknown as AuthService);

		it('a valid token → authMember is the member', async () => {
			const req = request('Bearer token');

			await expect(guard().canActivate(graphqlContext(req))).resolves.toBe(true);
			expect(req.body.authMember).toEqual(creator);
		});

		it('no token → a guest (null), without calling authenticate', async () => {
			const req = request();

			await expect(guard().canActivate(graphqlContext(req))).resolves.toBe(true);
			expect(req.body.authMember).toBeNull();
			expect(authService.authenticate).not.toHaveBeenCalled();
		});

		it.each([
			['an invalid token', new UnauthorizedException(Message.NOT_AUTHENTICATED)],
			['a blocked member', new ForbiddenException(Message.BLOCKED_USER)],
		])('%s → a guest (null), never an error', async (_label, error) => {
			authService.authenticate.mockRejectedValue(error);
			const req = request('Bearer token');

			await expect(guard().canActivate(graphqlContext(req))).resolves.toBe(true);
			expect(req.body.authMember).toBeNull();
		});

		it('ignores a client-sent authMember: it is always overwritten', async () => {
			const req = request();
			req.body.authMember = { _id: new Types.ObjectId(), memberType: MemberType.ADMIN, memberNick: 'fake' };
			await guard().canActivate(graphqlContext(req));

			expect(req.body.authMember).toBeNull();
		});
	});
});
