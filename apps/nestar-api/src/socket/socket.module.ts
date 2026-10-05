import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SocketGateway } from './socket.gateway';
import { AuthModule } from '../components/auth/auth.module';
import MemberSchema from '../schemas/Member.model';

@Module({
	imports: [AuthModule, MongooseModule.forFeature([{ name: 'Member', schema: MemberSchema }])],
	providers: [SocketGateway],
})
export class SocketModule {}
