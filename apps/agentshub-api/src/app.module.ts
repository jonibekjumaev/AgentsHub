import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { AppResolver } from './app.resolver';
import { ComponentsModule } from './components/components.module';
import { DatabaseModule } from './database/database.module';
import { FormattedErrorExtensions } from './libs/types/common';
import { GraphQLFormattedError } from 'graphql';
import { SocketModule } from './socket/socket.module';

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
				console.log('GRAPHQL GLOBAL ERR:', error);

				const extensions = formattedError.extensions as FormattedErrorExtensions | undefined;

				const graphQLFormattedError: GraphQLFormattedError = {
					message: extensions?.exception?.response?.message || extensions?.response?.message || formattedError.message,
					extensions: {
						code: extensions?.code,
					},
				};

				console.log('GRAPHQL GLOBAL ERR:', graphQLFormattedError);
				return graphQLFormattedError;
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
