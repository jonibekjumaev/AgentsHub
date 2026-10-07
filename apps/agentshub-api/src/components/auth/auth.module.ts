import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import MemberSchema from '../../schemas/Member.model';

@Module({
	imports: [
		HttpModule,
		MongooseModule.forFeature([{ name: 'Member', schema: MemberSchema }]), // member status check (B17)
		JwtModule.register({
			secret: `${process.env.SECRET_TOKEN}`,
			signOptions: { expiresIn: '30d' },
		}),
	],
	providers: [AuthService],
	exports: [AuthService], // Step -2
})
export class AuthModule {}
