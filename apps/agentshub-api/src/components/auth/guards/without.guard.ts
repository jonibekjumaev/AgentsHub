import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';
import { AuthPayload } from '../../../libs/types/common';

@Injectable()
export class WithoutGuard implements CanActivate {
	constructor(private authService: AuthService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		console.info('--- @guard() Authentication [WithoutGuard] ---');

		if (context.getType<GqlContextType>() === 'graphql') {
			const gqlContext = GqlExecutionContext.create(context);
			const request: Request = gqlContext.getContext<{ req: Request }>().req;
			const bearerToken = request.headers.authorization;

			// no token, an invalid one, or a member who isn't ACTIVE in the DB → guest, never an error (B17)
			let authMember: AuthPayload | null = null;

			if (bearerToken) {
				try {
					authMember = await this.authService.authenticate(bearerToken);
				} catch {
					authMember = null;
				}
			}

			(request.body as Record<string, unknown>).authMember = authMember;
			console.log('memberNick[without] =>', authMember?.memberNick ?? 'none');
			return true;
		}

		// http, rpc, ws â bu guard hech kimni bloklamaydi, shuning uchun o'tkazib yuboriladi
		return true;
	}
}
