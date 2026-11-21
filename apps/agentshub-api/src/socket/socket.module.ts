import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SocketGateway } from './socket.gateway';
import { AuthModule } from '../components/auth/auth.module';
import MemberSchema from '../schemas/Member.model';
import { MemberPublisher } from './member.publisher';

@Module({
	imports: [AuthModule, MongooseModule.forFeature([{ name: 'Member', schema: MemberSchema }])],
	// D-49 / D-50: the gateway is also the publisher of chat and notification pushes (ChatModule, NotificationModule)
	providers: [SocketGateway, { provide: MemberPublisher, useExisting: SocketGateway }],
	exports: [MemberPublisher],
})
export class SocketModule {}
