import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { GraphQLResolveInfo } from 'graphql';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { redactRequestBody } from '../utils';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
	private readonly logger: Logger = new Logger();

	public intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
		const recordTime = Date.now();
		const requestType = context.getType<GqlContextType>();

		if (requestType === 'graphql') {
			/* (1) Print Request */
			const gqlContext = GqlExecutionContext.create(context);
			const requestContext = gqlContext.getContext<{ req?: { body?: unknown } }>();
			// redact before truncating, so a password can't be cut in half and partly logged (S12)
			this.logger.log(this.stringify(redactRequestBody(requestContext.req?.body)), 'REQUEST');

			/* (2) Print Response: operation, duration and result only, never the body (S16) */
			const info = gqlContext.getInfo<GraphQLResolveInfo>();
			const operation = `${info.parentType.name} ${info.fieldName}`;
			const logResponse = (result: 'success' | 'error') => {
				const responseTime = Date.now() - recordTime;
				this.logger.log(`${operation} - ${responseTime}ms - ${result} \n\n`, 'RESPONSE');
			};

			return next.handle().pipe(
				tap({
					next: () => logResponse('success'),
					error: () => logResponse('error'),
				}),
			);
		}

		// http yoki boshqa turdagi so'rov — hozircha log qilinmaydi, lekin so'rov baribir davom etishi SHART
		return next.handle();
	}

	private stringify(value: unknown): string {
		return (JSON.stringify(value) ?? '').slice(0, 75);
	}
}

//  public intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
// 		const recordTime = Date.now();
// 		const requestType = context.getType<GqlContextType>();

// 		if (requestType === 'http') {
// 			/* Develop if needed! */
// 		} else if (requestType === 'graphql') {
// 			/** (1) Print Request */
// 			const gqlContext = GqlExecutionContext.create(context);
// 			this.logger.log(`${this.stringify(gqlContext.getContext().req.body)}`, 'REQUEST');

// 			/* (2) Errors handing via GraphQL */

// 			/* (3) No Errors, giving Response below */
// 			return next.handle().pipe(
// 				tap((context) => {
// 					const responseTime = Date.now() - recordTime;
// 					this.logger.log(`${this.stringify(context)} - ${responseTime}ms \n\n`, 'RESPONSE');
// 				}),
// 			);
// 		}
// 	}
