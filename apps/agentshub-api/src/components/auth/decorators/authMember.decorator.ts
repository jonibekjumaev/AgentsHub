import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';
import { AuthPayload } from '../../../libs/types/common';

/** Only the S9 token claims are available here. Load any other member field from the DB. */
export const AuthMember = createParamDecorator((data: keyof AuthPayload | undefined, context: ExecutionContext) => {
	let request: Request;

	if (context.getType<GqlContextType>() === 'graphql') {
		const gqlContext = GqlExecutionContext.create(context);
		request = gqlContext.getContext<{ req: Request }>().req;

		const body = request.body as Record<string, unknown>;
		if (body.authMember) {
			(body.authMember as AuthPayload & { authorization?: string }).authorization = request.headers?.authorization;
		}
	} else {
		request = context.switchToHttp().getRequest<Request>();
	}

	const member = (request.body as Record<string, unknown>).authMember as AuthPayload | undefined;

	if (member) return data ? member[data] : member;
	else return null;
});
