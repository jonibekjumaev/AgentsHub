import { ClassConstructor } from 'class-transformer';
import { validationErrors } from '../../../test/utils/validate-dto';
import { listPageMax } from '../config';
import { OrdinaryInquiry } from './common.input';
import { AllBoardArticlesInquiry, BoardArticlesInquiry } from './board-article/board-article.input';
import { AllBriefsInquiry, BriefsInquiry, MyBriefsInquiry } from './brief/brief.input';
import { ConversationsAdminInquiry } from './chat/chat.input';
import { CommentsInquiry } from './comment/comment.input';
import { FollowInquiry } from './follow/follow.input';
import { CreatorsInquiry, MembersInquiry } from './member/member.input';
import { NotificationsInquiry } from './notification/notification.input';
import { BriefOffersInquiry, MyOffersInquiry } from './offer/offer.input';
import { AllProductsInquiry, CreatorProductsInquiry, ProductsInquiry } from './product/product.input';

/**
 * D-51: every paged list takes whole numbers, and at most listPageMax items per page (some lists allow fewer). Only the
 * `page` / `limit` errors are checked here: each list's own search rules have their own specs.
 */
const lists: Array<[string, ClassConstructor<object>, number]> = [
	['OrdinaryInquiry', OrdinaryInquiry, listPageMax],
	['BoardArticlesInquiry', BoardArticlesInquiry, listPageMax],
	['AllBoardArticlesInquiry', AllBoardArticlesInquiry, listPageMax],
	['BriefsInquiry', BriefsInquiry, listPageMax],
	['MyBriefsInquiry', MyBriefsInquiry, listPageMax],
	['AllBriefsInquiry', AllBriefsInquiry, listPageMax],
	['CommentsInquiry', CommentsInquiry, listPageMax],
	['FollowInquiry', FollowInquiry, listPageMax],
	['CreatorsInquiry', CreatorsInquiry, listPageMax],
	['MembersInquiry', MembersInquiry, listPageMax],
	['MyOffersInquiry', MyOffersInquiry, listPageMax],
	['BriefOffersInquiry', BriefOffersInquiry, listPageMax],
	['ProductsInquiry', ProductsInquiry, listPageMax],
	['CreatorProductsInquiry', CreatorProductsInquiry, listPageMax],
	['AllProductsInquiry', AllProductsInquiry, listPageMax],
	['ConversationsAdminInquiry', ConversationsAdminInquiry, listPageMax],
	['NotificationsInquiry', NotificationsInquiry, 50],
];

describe('list pages (D-51)', () => {
	it.each(lists)('%s: limit 1..%s, whole numbers only', async (_name, cls, max) => {
		const errorsOf = async (page: number, limit: number) => Object.keys(await validationErrors(cls, { page, limit }));

		expect(await errorsOf(1, max)).not.toEqual(expect.arrayContaining(['limit']));
		expect(await errorsOf(1, max + 1)).toContain('limit');
		expect(await errorsOf(1, 0)).toContain('limit');
		expect(await errorsOf(1, 1.5)).toContain('limit');
		expect(await errorsOf(1.5, 10)).toContain('page');
		expect(await errorsOf(1, 10)).not.toEqual(expect.arrayContaining(['page']));
	});
});
