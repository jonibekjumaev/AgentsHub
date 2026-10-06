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
import { redactSensitiveText } from './libs/utils';

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
				// ValidationPipe errors carry an array of messages
				const rawMessage =
					extensions?.exception?.response?.message || extensions?.response?.message || formattedError.message;

				// graphql-js can echo input values (e.g. a password) in the message: redact for the log and the client (S15)
				const message = Array.isArray(rawMessage)
					? rawMessage.map((text) => redactSensitiveText(text))
					: redactSensitiveText(rawMessage);
				const path = formattedError.path?.join('.') ?? '-';
				console.log(`GRAPHQL ERROR [${code}] ${path}: ${Array.isArray(message) ? message.join(' | ') : message}`);

				// unexpected errors (bugs, database errors) also get their stack; Nest exceptions and GraphQL errors don't need it
				const original = unwrapResolverError(error);
				if (original instanceof Error && !(original instanceof HttpException) && !(original instanceof GraphQLError)) {
					console.log('GRAPHQL ERROR stack:', redactSensitiveText(original.stack ?? original.message));
				}

				return { message, extensions: { code } } as GraphQLFormattedError;
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
