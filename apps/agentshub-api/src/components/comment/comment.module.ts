import { Module } from '@nestjs/common';
import { CommentResolver } from './comment.resolver';
import { CommentService } from './comment.service';
import { MongooseModule } from '@nestjs/mongoose';
import CommentSchema from '../../schemas/Comment.model';
import ProductSchema from '../../schemas/Product.model';
import BoardArticleSchema from '../../schemas/BoardArticle.model';
import MemberSchema from '../../schemas/Member.model';
import { AuthModule } from '../auth/auth.module';
import { MemberModule } from '../member/member.module';
import { ViewModule } from '../view/view.module';
import { BoardArticleModule } from '../board-article/board-article.module';
import { ProductModule } from '../product/product.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{
				name: 'Comment',
				schema: CommentSchema,
			},
			{
				name: 'Product',
				schema: ProductSchema,
			},
			{
				name: 'BoardArticle',
				schema: BoardArticleSchema,
			},
			{
				name: 'Member',
				schema: MemberSchema,
			},
		]),
		AuthModule,
		MemberModule,
		ViewModule,
		BoardArticleModule,
		ProductModule,
	],
	providers: [CommentResolver, CommentService],
	exports: [CommentService],
})
export class CommentModule {}
