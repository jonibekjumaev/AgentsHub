import { Module } from '@nestjs/common';
import { InjectConnection, MongooseModule } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Module({
	imports: [
		MongooseModule.forRootAsync({
			useFactory: () => ({
				uri: process.env.NODE_ENV === 'production' ? process.env.MONGODB_PROD : process.env.MONGODB_DEV,
			}),
		}),
	],
	exports: [],
})
export class DatabaseModule {
	constructor(@InjectConnection() private readonly connection: Connection) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
		if (connection.readyState === 1) {
			console.log(`MongoDB connected into ${process.env.NODE_ENV === 'production' ? 'production' : ' development'}`);
		} else {
			console.log('DB is not connected!');
		}
	}
}
