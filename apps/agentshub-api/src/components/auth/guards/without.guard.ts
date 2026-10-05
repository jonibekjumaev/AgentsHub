import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';
import { Member } from '../../../libs/dto/member/member';

@Injectable()
export class WithoutGuard implements CanActivate {
	constructor(private authService: AuthService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		console.info('--- @guard() Authentication [WithoutGuard] ---');

		if (context.getType<GqlContextType>() === 'graphql') {
			const gqlContext = GqlExecutionContext.create(context);
			const request: Request = gqlContext.getContext<{ req: Request }>().req;
			const bearerToken = request.headers.authorization;

			let authMember: Member | null = null;

			if (bearerToken) {
				try {
					const token = bearerToken.split(' ')[1];
					authMember = await this.authService.verifyToken(token);
				} catch {
					authMember = null;
				}
			}

			(request.body as Record<string, unknown>).authMember = authMember;
			console.log('memberNick[without] =>', authMember?.memberNick ?? 'none');
			return true;
		}

		// http, rpc, ws — bu guard hech kimni bloklamaydi, shuning uchun o'tkazib yuboriladi
		return true;
	}
}
