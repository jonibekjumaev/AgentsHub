import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth.service';
import { Message } from '../../../libs/enums/common.enum';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';

@Injectable()
export class RolesGuard implements CanActivate {
	constructor(
		private reflector: Reflector,
		private authService: AuthService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const roles = this.reflector.get<string[]>('roles', context.getHandler());
		if (!roles) return true;

		console.info(`--- @guard() Authentication [RolesGuard]: ${roles.join(', ')} ---`);

		if (context.getType<GqlContextType>() === 'graphql') {
			const gqlContext = GqlExecutionContext.create(context);
			const request: Request = gqlContext.getContext<{ req: Request }>().req;

			// valid token and an ACTIVE member in the DB first (401 / 403 BLOCKED_USER, B17), then the role
			const authMember = await this.authService.authenticate(request.headers.authorization);
			if (!roles.includes(authMember.memberType)) throw new ForbiddenException(Message.ONLY_SPECIFIC_ROLES_ALLOWED);

			console.log('memberNick[roles] =>', authMember.memberNick);
			(request.body as Record<string, unknown>).authMember = authMember;
			return true;
		}

		// http, rpc, ws va boshqa noma'lum turdagi so'rovlar — xavfsizlik uchun rad etiladi
		return false;
	}
}
