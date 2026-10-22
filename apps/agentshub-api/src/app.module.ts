import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { ComponentsModule } from './components/components.module';
import { DatabaseModule } from './database/database.module';
import { SocketModule } from './socket/socket.module';
import { formatGraphqlError } from './libs/format-error';

@Module({
	imports: [
		ConfigModule.forRoot(), //.env ni uqish uchun
		GraphQLModule.forRoot({
			// rest api => graphql api
			driver: ApolloDriver,
			// playground: true,
			uploads: false,
			autoSchemaFile: true,
			formatError: formatGraphqlError,
		}),
		ComponentsModule,
		DatabaseModule,
		SocketModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule {}
