import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { ComponentsModule } from './components/components.module';
import { DatabaseModule } from './database/database.module';
import { SocketModule } from './socket/socket.module';
import { formatGraphqlError } from './libs/format-error';
import { depthLimit } from './libs/graphql-depth-limit';
import { graphqlMaxDepth } from './libs/config';

@Module({
	imports: [
		ConfigModule.forRoot(), //.env ni uqish uchun
		// D-52: in-process events (the embedding sync runs after the request that asked for it)
		EventEmitterModule.forRoot(),
		GraphQLModule.forRoot({
			// rest api => graphql api
			driver: ApolloDriver,
			// playground: true,
			uploads: false,
			autoSchemaFile: true,
			formatError: formatGraphqlError,
			// D-51: refuse deeply nested operations before they run
			validationRules: [depthLimit(graphqlMaxDepth)],
		}),
		ComponentsModule,
		DatabaseModule,
		SocketModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule {}
