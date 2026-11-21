import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatResolver } from './chat.resolver';
import { ChatService } from './chat.service';
import ConversationSchema from '../../schemas/Conversation.model';
import ChatMessageSchema from '../../schemas/ChatMessage.model';
import OfferSchema from '../../schemas/Offer.model';
import { AuthModule } from '../auth/auth.module';
import { SocketModule } from '../../socket/socket.module';

/** D-49: conversations on offers. Pushes go through MemberPublisher, which SocketModule provides. */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Conversation', schema: ConversationSchema },
			{ name: 'ChatMessage', schema: ChatMessageSchema },
			{ name: 'Offer', schema: OfferSchema },
		]),
		AuthModule,
		SocketModule,
	],
	providers: [ChatResolver, ChatService],
	exports: [ChatService],
})
export class ChatModule {}
