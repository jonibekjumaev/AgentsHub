import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';
import { Member } from '../../../libs/dto/member/member';

export const AuthMember = createParamDecorator((data: string, context: ExecutionContext) => {
	let request: Request;

	if (context.getType<GqlContextType>() === 'graphql') {
		const gqlContext = GqlExecutionContext.create(context);
		request = gqlContext.getContext<{ req: Request }>().req;

		const body = request.body as Record<string, unknown>;
		if (body.authMember) {
			(body.authMember as Member & { authorization?: string }).authorization = request.headers?.authorization;
		}
	} else {
		request = context.switchToHttp().getRequest<Request>();
	}

	const member = (request.body as Record<string, unknown>).authMember as Member | undefined;

	if (member) return data ? member[data as keyof Member] : member;
	else return null;
});
