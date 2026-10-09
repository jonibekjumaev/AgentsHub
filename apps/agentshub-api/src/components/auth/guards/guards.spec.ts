import { readdirSync } from 'fs';
import { join } from 'path';
import {
	ExecutionContext,
	ForbiddenException,
	InternalServerErrorException,
	UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
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

		it.each([
			['without @Roles', undefined],
			['with an empty @Roles()', []],
		])(
			'fails closed for a method %s (B21): 500, even with a valid token, before any DB read',
			async (_label, roles) => {
				const req = request('Bearer token');

				await expectHttpError(
					guard().canActivate(graphqlContext(req, roles)),
					InternalServerErrorException,
					Message.SOMETHING_WENT_WRONG,
				);
				expect(authService.authenticate).not.toHaveBeenCalled();
				expect(req.body.authMember).toBeUndefined();
			},
		);
	});

	describe('every resolver method guarded by RolesGuard has @Roles (B21)', () => {
		// every *.resolver.ts under components/, so a new resolver is checked without editing this test
		const resolverFiles = readdirSync(join(__dirname, '..', '..'), { recursive: true, encoding: 'utf8' })
			.filter((file) => file.endsWith('.resolver.ts'))
			.map((file) => join(__dirname, '..', '..', file));

		const guardedMethods = resolverFiles.flatMap((file) => {
			const exports = require(file) as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-require-imports
			const classes = Object.values(exports).filter((value): value is new () => object => typeof value === 'function');
			return classes.flatMap((cls) => {
				const classGuards = (Reflect.getMetadata(GUARDS_METADATA, cls) ?? []) as unknown[];
				return Object.getOwnPropertyNames(cls.prototype)
					.filter((name) => name !== 'constructor')
					.map((name) => {
						const method = (cls.prototype as Record<string, unknown>)[name] as object;
						const guards = [...classGuards, ...((Reflect.getMetadata(GUARDS_METADATA, method) ?? []) as unknown[])];
						const roles = Reflect.getMetadata('roles', method) as string[] | undefined;
						return { name: `${cls.name}.${name}`, guarded: guards.includes(RolesGuard), roles };
					})
					.filter((method) => method.guarded);
			});
		});

		it('finds the RolesGuard methods (19 when B21 was fixed)', () => {
			expect(guardedMethods.length).toBeGreaterThanOrEqual(19);
		});

		it('none of them is missing @Roles or has an empty one', () => {
			expect(guardedMethods.filter((method) => !method.roles?.length).map((method) => method.name)).toEqual([]);
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
