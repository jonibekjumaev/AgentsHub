import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
	constructor(private authService: AuthService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		console.info('--- @guard() Authentication [AuthGuard] ---');

		if (context.getType<GqlContextType>() === 'graphql') {
			const gqlContext = GqlExecutionContext.create(context);
			const request: Request = gqlContext.getContext<{ req: Request }>().req;

			// valid token and an ACTIVE member in the DB; otherwise 401 / 403 BLOCKED_USER (B17)
			const authMember = await this.authService.authenticate(request.headers.authorization);

			console.log('memberNick[auth] =>', authMember.memberNick);
			(request.body as Record<string, unknown>).authMember = authMember;

			return true;
		}

		// http, rpc, ws va boshqa noma'lum turdagi so'rovlar — xavfsizlik uchun rad etiladi
		return false;
	}
}
