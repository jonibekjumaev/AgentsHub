import { AgentCategory } from '../../apps/agentshub-api/src/libs/enums/agent-category.enum';
import { BoardArticleCategory } from '../../apps/agentshub-api/src/libs/enums/board-article.enum';
import { MemberType } from '../../apps/agentshub-api/src/libs/enums/member.enum';
import { ProductPricing, ProductStatus } from '../../apps/agentshub-api/src/libs/enums/product.enum';

/** Every seed member's nick starts with this; the seed deletes and recreates exactly these members and their data. */
export const seedNickPrefix = 'seed_';

/** Placeholder images in scripts/seed/images/, copied into uploads/product/ under the same names. */
export const seedImages = ['seed-product-1.png', 'seed-product-2.png', 'seed-product-3.png'];

export interface SeedMember {
	nick: string;
	type: MemberType.CREATOR | MemberType.USER;
	phone: string; // E.164 (D-25), in a range unlikely to clash with real members (memberPhone is unique)
	fullName: string;
	desc: string;
	email?: string;
	whatsapp?: string;
	blocked?: boolean; // set to BLOCK after its interactions, like a member blocked later by an admin
}

export const seedMembers: SeedMember[] = [
	{
		nick: 'seed_nova',
		type: MemberType.CREATOR,
		phone: '+19990000101',
		fullName: 'Nova Labs',
		desc: 'We build support and sales agents for small online shops.',
		email: 'nova@example.com',
		whatsapp: '+19990000101',
	},
	{
		nick: 'seed_orbit',
		type: MemberType.CREATOR,
		phone: '+19990000102',
		fullName: 'Orbit Automation',
		desc: 'Workflow and data agents that plug into the tools you already use.',
		email: 'orbit@example.com',
	},
	{
		nick: 'seed_pixel',
		type: MemberType.CREATOR,
		phone: '+19990000103',
		fullName: 'Pixel Writer',
		desc: 'Content and marketing agents tuned for brand voice.',
		whatsapp: '+19990000103',
	},
	{
		nick: 'seed_quill',
		type: MemberType.CREATOR,
		phone: '+19990000104',
		fullName: 'Quill Tutors',
		desc: 'Education agents for language schools and online courses.',
		email: 'quill@example.com',
	},
	{
		nick: 'seed_ana',
		type: MemberType.USER,
		phone: '+19990000201',
		fullName: 'Ana Rivera',
		desc: 'Runs a small e-commerce store.',
		email: 'ana@example.com',
	},
	{
		nick: 'seed_ben',
		type: MemberType.USER,
		phone: '+19990000202',
		fullName: 'Ben Okafor',
		desc: 'Operations lead at a logistics startup.',
		whatsapp: '+19990000202',
	},
	{
		nick: 'seed_cara',
		type: MemberType.USER,
		phone: '+19990000203',
		fullName: 'Cara Lindqvist',
		desc: 'Marketing manager looking for content automation.',
	},
	{
		nick: 'seed_dan',
		type: MemberType.USER,
		phone: '+19990000204',
		fullName: 'Dan Petrov',
		desc: 'Blocked seed account, for testing BLOCKED_USER.',
		blocked: true,
	},
];

export interface SeedProduct {
	creator: string; // a seed creator's nick
	category: AgentCategory;
	pricing: ProductPricing;
	price?: number; // only ONE_TIME / SUBSCRIPTION (D-03)
	title: string;
	desc: string;
	tags: string[];
	demoUrl?: string;
	images: number[]; // indexes into seedImages
	status?: ProductStatus.PAUSED | ProductStatus.DELETE; // set through updateProduct after create (D-16)
}

export const seedProducts: SeedProduct[] = [
	{
		creator: 'seed_nova',
		category: AgentCategory.CUSTOMER_SUPPORT,
		pricing: ProductPricing.SUBSCRIPTION,
		price: 49,
		title: 'HelpDesk Copilot',
		desc: 'Answers customer questions from your help center and hands complex tickets to a human.',
		tags: ['support', 'tickets', 'zendesk'],
		demoUrl: 'https://example.com/demo/helpdesk-copilot',
		images: [0, 1],
	},
	{
		creator: 'seed_nova',
		category: AgentCategory.SALES,
		pricing: ProductPricing.ONE_TIME,
		price: 299,
		title: 'Lead Qualifier',
		desc: 'Scores inbound leads from web forms and books meetings for the best ones.',
		tags: ['sales', 'crm', 'leads'],
		images: [1],
	},
	{
		creator: 'seed_nova',
		category: AgentCategory.CUSTOMER_SUPPORT,
		pricing: ProductPricing.FREE,
		title: 'FAQ Bot Starter',
		desc: 'A free starter agent that answers the twenty most common store questions.',
		tags: ['support', 'faq'],
		images: [2],
	},
	{
		creator: 'seed_orbit',
		category: AgentCategory.AUTOMATION,
		pricing: ProductPricing.SUBSCRIPTION,
		price: 89.5,
		title: 'Invoice Router',
		desc: 'Reads incoming invoices, extracts totals and routes them for approval.',
		tags: ['finance', 'automation', 'ocr'],
		demoUrl: 'https://example.com/demo/invoice-router',
		images: [0],
	},
	{
		creator: 'seed_orbit',
		category: AgentCategory.DATA_ANALYSIS,
		pricing: ProductPricing.CUSTOM,
		title: 'Weekly KPI Analyst',
		desc: 'Builds a weekly KPI report from your spreadsheets and explains what changed.',
		tags: ['analytics', 'reports', 'sheets'],
		images: [1, 2],
	},
	{
		creator: 'seed_orbit',
		category: AgentCategory.AUTOMATION,
		pricing: ProductPricing.ONE_TIME,
		price: 150,
		title: 'Inbox Triage',
		desc: 'Sorts a shared inbox into labels and drafts replies for routine requests.',
		tags: ['email', 'automation'],
		images: [2],
		status: ProductStatus.PAUSED,
	},
	{
		creator: 'seed_pixel',
		category: AgentCategory.CONTENT,
		pricing: ProductPricing.SUBSCRIPTION,
		price: 29,
		title: 'Blog Drafter',
		desc: 'Turns an outline and a few links into an on-brand blog draft ready for editing.',
		tags: ['content', 'blog', 'seo'],
		demoUrl: 'https://example.com/demo/blog-drafter',
		images: [0, 2],
	},
	{
		creator: 'seed_pixel',
		category: AgentCategory.MARKETING,
		pricing: ProductPricing.ONE_TIME,
		price: 79,
		title: 'Ad Copy Studio',
		desc: 'Writes and A/B-tests ad copy variants for search and social campaigns.',
		tags: ['marketing', 'ads', 'copywriting'],
		images: [1],
	},
	{
		creator: 'seed_pixel',
		category: AgentCategory.MARKETING,
		pricing: ProductPricing.FREE,
		title: 'Hashtag Helper',
		desc: 'Suggests relevant hashtags and posting times for each social post.',
		tags: ['social', 'marketing'],
		images: [2],
		status: ProductStatus.DELETE,
	},
	{
		creator: 'seed_quill',
		category: AgentCategory.EDUCATION,
		pricing: ProductPricing.SUBSCRIPTION,
		price: 19,
		title: 'Grammar Coach',
		desc: 'Corrects learner essays and explains each grammar mistake in simple words.',
		tags: ['education', 'language', 'writing'],
		images: [0],
	},
	{
		creator: 'seed_quill',
		category: AgentCategory.EDUCATION,
		pricing: ProductPricing.CUSTOM,
		title: 'Course Builder',
		desc: 'Plans a full online course with lessons, quizzes and a weekly schedule.',
		tags: ['education', 'courses'],
		demoUrl: 'https://example.com/demo/course-builder',
		images: [1, 2],
	},
	{
		creator: 'seed_quill',
		category: AgentCategory.OTHER,
		pricing: ProductPricing.FREE,
		title: 'Meeting Notes Taker',
		desc: 'Summarizes meeting transcripts into decisions, owners and next steps.',
		tags: ['productivity', 'meetings'],
		images: [0],
	},
];

export interface SeedArticle {
	author: string; // a seed member's nick
	category: BoardArticleCategory;
	title: string;
	content: string;
}

export const seedArticles: SeedArticle[] = [
	{
		author: 'seed_nova',
		category: BoardArticleCategory.NEWS,
		title: 'HelpDesk Copilot now supports handoff',
		content: 'Tickets the agent cannot solve are now passed to a human with a short summary of the conversation.',
	},
	{
		author: 'seed_ana',
		category: BoardArticleCategory.RECOMMEND,
		title: 'What worked for our store',
		content: 'We tried three support agents. The one that read our help center answered most questions correctly.',
	},
	{
		author: 'seed_ben',
		category: BoardArticleCategory.FREE,
		title: 'How do you write a good brief?',
		content: 'Looking for tips on describing an automation need so creators can quote it quickly.',
	},
	{
		author: 'seed_pixel',
		category: BoardArticleCategory.HUMOR,
		title: 'My agent wrote a haiku about invoices',
		content: 'Totals add up / approval waits in the queue / coffee grows cold now.',
	},
];

/** Who follows whom (follower → following). */
export const seedFollows: [string, string][] = [
	['seed_ana', 'seed_nova'],
	['seed_ana', 'seed_pixel'],
	['seed_ben', 'seed_orbit'],
	['seed_ben', 'seed_nova'],
	['seed_cara', 'seed_pixel'],
	['seed_dan', 'seed_quill'],
	['seed_orbit', 'seed_nova'],
];

/** Product likes and views by member nick, as indexes into seedProducts (only products that stay ACTIVE). */
export const seedProductLikes: [string, number[]][] = [
	['seed_ana', [0, 2, 6]],
	['seed_ben', [0, 3, 4]],
	['seed_cara', [6, 7, 9]],
	['seed_dan', [10]],
	['seed_orbit', [0]],
];

export const seedProductViews: [string, number[]][] = [
	['seed_ana', [0, 1, 2, 6, 7]],
	['seed_ben', [0, 3, 4, 9]],
	['seed_cara', [6, 7, 9, 10, 11]],
	['seed_dan', [10, 11]],
	['seed_pixel', [0, 3]],
];

/** Member likes and profile views (liker/viewer → target). */
export const seedMemberLikes: [string, string][] = [
	['seed_ana', 'seed_nova'],
	['seed_ben', 'seed_orbit'],
	['seed_cara', 'seed_pixel'],
	['seed_nova', 'seed_quill'],
];

export const seedMemberViews: [string, string][] = [
	['seed_ana', 'seed_nova'],
	['seed_ana', 'seed_pixel'],
	['seed_ben', 'seed_orbit'],
	['seed_cara', 'seed_pixel'],
	['seed_dan', 'seed_quill'],
];

/** Article likes (member → index into seedArticles); the liker also views the article. */
export const seedArticleLikes: [string, number][] = [
	['seed_ana', 3],
	['seed_cara', 1],
	['seed_quill', 3],
];

/** Comments: on a product (index), an article (index) or a member (nick). */
export const seedComments: { author: string; product?: number; article?: number; member?: string; text: string }[] = [
	{ author: 'seed_ana', product: 0, text: 'Set it up in an afternoon, works well.' },
	{ author: 'seed_ben', product: 0, text: 'Does it support German?' },
	{ author: 'seed_nova', product: 0, text: 'Yes, German and French are supported.' },
	{ author: 'seed_ben', product: 4, text: 'Can it read Google Sheets directly?' },
	{ author: 'seed_cara', product: 6, text: 'The drafts need little editing.' },
	{ author: 'seed_ana', article: 2, text: 'Start with the problem, not the solution.' },
	{ author: 'seed_quill', article: 3, text: 'Ha, this made my day.' },
	{ author: 'seed_cara', member: 'seed_pixel', text: 'Great to work with.' },
];
