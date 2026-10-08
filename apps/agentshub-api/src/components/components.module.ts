import { Module } from '@nestjs/common';
import { MemberModule } from './member/member.module';
import { ProductModule } from './product/product.module';
import { AuthModule } from './auth/auth.module';
import { CommentModule } from './comment/comment.module';
import { LikeModule } from './like/like.module';
import { ViewModule } from './view/view.module';
import { FollowModule } from './follow/follow.module';
import { BoardArticleModule } from './board-article/board-article.module';
import { BriefModule } from './brief/brief.module';

@Module({
	imports: [
		MemberModule,
		AuthModule,
		ProductModule,
		BriefModule,
		BoardArticleModule,
		CommentModule,
		LikeModule,
		ViewModule,
		FollowModule,
	],
})
export class ComponentsModule {}
