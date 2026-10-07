import { HttpException, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { AppResolver } from './app.resolver';
import { ComponentsModule } from './components/components.module';
import { DatabaseModule } from './database/database.module';
import { FormattedErrorExtensions } from './libs/types/common';
import { GraphQLError, GraphQLFormattedError } from 'graphql';
import { unwrapResolverError } from '@apollo/server/errors';
import { SocketModule } from './socket/socket.module';
import { redactDuplicateKey, redactSensitiveText } from './libs/utils';

@Module({
	imports: [
		ConfigModule.forRoot(), //.env ni uqish uchun
		GraphQLModule.forRoot({
			// rest api => graphql api
			driver: ApolloDriver,
			// playground: true,
			uploads: false,
			autoSchemaFile: true,
			formatError: (formattedError: GraphQLFormattedError, error: unknown): GraphQLFormattedError => {
				const extensions = formattedError.extensions as FormattedErrorExtensions | undefined;
				const code = extensions?.code;
				// a Nest exception's own message (an array for ValidationPipe errors) is in originalError (B14);
				// formattedError.message is only "Bad Request Exception" then
				const rawMessage = extensions?.originalError?.message || formattedError.message;

				// graphql-js can echo input values (e.g. a password) in the message: redact for the log and the client (S15)
				// The GraphQL spec requires `message` to be a string: validation messages are joined with "; ", and the
				// array goes to extensions.validationErrors so the frontend can show them per field (B14)
				const validationErrors = Array.isArray(rawMessage)
					? rawMessage.map((text) => redactSensitiveText(String(text)))
					: undefined;
				const message = validationErrors ? validationErrors.join('; ') : redactSensitiveText(String(rawMessage));
				const path = formattedError.path?.join('.') ?? '-';
				// E11000 duplicated values (phone, nick, title) are redacted in the log only; the client message is unchanged (B13)
				console.log(`GRAPHQL ERROR [${code}] ${path}: ${redactDuplicateKey(message)}`);

				// unexpected errors (bugs, database errors) also get their stack; Nest exceptions and GraphQL errors don't need it
				const original = unwrapResolverError(error);
				if (original instanceof Error && !(original instanceof HttpException) && !(original instanceof GraphQLError)) {
					console.log(
						'GRAPHQL ERROR stack:',
						redactDuplicateKey(redactSensitiveText(original.stack ?? original.message)),
					);
				}

				return { message, extensions: validationErrors ? { code, validationErrors } : { code } };
			},
		}),
		ComponentsModule,
		DatabaseModule,
		SocketModule,
	],
	controllers: [AppController],
	providers: [AppService, AppResolver],
})
export class AppModule {}
