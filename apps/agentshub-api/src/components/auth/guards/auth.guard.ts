import { BadRequestException, CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { Message } from '../../../libs/enums/common.enum';
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

			const bearerToken = request.headers.authorization;
			if (!bearerToken) throw new BadRequestException(Message.TOKEN_NOT_EXIST);

			const token = bearerToken.split(' ')[1];
			const authMember = await this.authService.verifyToken(token);
			if (!authMember) throw new UnauthorizedException(Message.NOT_AUTHENTICATED);

			console.log('memberNick[auth] =>', authMember.memberNick);
			(request.body as Record<string, unknown>).authMember = authMember;

			return true;
		}

		// http, rpc, ws va boshqa noma'lum turdagi so'rovlar — xavfsizlik uchun rad etiladi
		return false;
	}
}
