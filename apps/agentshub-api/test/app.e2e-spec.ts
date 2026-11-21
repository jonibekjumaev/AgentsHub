import { INestApplication } from '@nestjs/common';
import { Connection, Types } from 'mongoose';
import { ErrorReason, Message } from '../src/libs/enums/common.enum';
import { createE2eApp, gql, onlyError } from './e2e/e2e-app';

/**
 * API smoke suite (Step 11 part 6, D-32): the settled rules through the whole stack (GraphQL schema, guards,
 * ValidationPipe, services, formatError) on a throwaway in-memory database. The steps run in order and share the
 * members, products and briefs they create.
 */

const PASSWORD = 'e2e-password-1';
const MEMBER = `_id memberNick memberType memberStatus memberEmail memberWhatsapp memberProducts memberBriefs accessToken`;

describe('AgentsHub API (e2e smoke)', () => {
	let app: INestApplication;
	let connection: Connection;

	const user = { _id: '', token: '' };
	const creator = { _id: '', token: '' };
	let productId = '';
	let briefId = '';

	beforeAll(async () => {
		({ app, connection } = await createE2eApp());
	});

	afterAll(async () => {
		await app?.close();
	});

	const signup = (memberNick: string, memberType: string, memberPhone: string) =>
		gql<{ signup: Record<string, string> }>(
			app,
			`mutation ($input: MemberInput!) { signup(input: $input) { ${MEMBER} } }`,
			{ input: { memberNick, memberPassword: PASSWORD, memberPhone, memberType } },
		);
	const getMember = (memberId: string, token?: string) =>
		gql<{ getMember: Record<string, unknown> }>(
			app,
			`query ($id: String!) { getMember(memberId: $id) { ${MEMBER} } }`,
			{ id: memberId },
			token,
		);
	const getMe = (token?: string) =>
		gql<{ getMe: Record<string, unknown> }>(app, `query { getMe { ${MEMBER} } }`, {}, token);
	const login = (memberNick: string) =>
		gql<{ login: { accessToken: string } }>(
			app,
			`mutation ($input: LoginInput!) { login(input: $input) { accessToken } }`,
			{ input: { memberNick, memberPassword: PASSWORD } },
		);
	const getProduct = (id: string, token?: string) =>
		gql<{ getProduct: { _id: string; productStatus: string; memberData: Record<string, unknown> } }>(
			app,
			`query ($id: String!) { getProduct(productId: $id) { _id productStatus memberData { memberNick memberEmail memberWhatsapp } } }`,
			{ id },
			token,
		);
	const getBrief = (id: string, token?: string) =>
		gql<{ getBrief: { _id: string; briefStatus: string } }>(
			app,
			`query ($id: String!) { getBrief(briefId: $id) { _id briefStatus } }`,
			{ id },
			token,
		);

	describe('signup and login', () => {
		it('a USER and a CREATOR can sign up and get a token', async () => {
			const userSignup = await signup('e2e_user', 'USER', '+998900000001');
			const creatorSignup = await signup('e2e_creator', 'CREATOR', '+998900000002');

			expect(userSignup.errors).toBeUndefined();
			expect(creatorSignup.errors).toBeUndefined();
			Object.assign(user, userSignup.data!.signup);
			Object.assign(creator, creatorSignup.data!.signup);
			user.token = userSignup.data!.signup.accessToken;
			creator.token = creatorSignup.data!.signup.accessToken;
			expect(user.token).toEqual(expect.any(String));
			expect(creatorSignup.data!.signup.memberType).toBe('CREATOR');
		});

		it('nobody can sign up as ADMIN (D-14)', async () => {
			const error = onlyError(await signup('e2e_admin', 'ADMIN', '+998900000003'));

			expect(error.code).toBe('BAD_REQUEST');
			expect(await connection.collection('members').countDocuments({ memberNick: 'e2e_admin' })).toBe(0);
		});

		it('memberType is required at signup (D-14)', async () => {
			const response = await gql(
				app,
				`mutation { signup(input: { memberNick: "e2e_none", memberPassword: "${PASSWORD}", memberPhone: "+998900000004" }) { _id } }`,
			);

			expect(onlyError(response).code).toBe('GRAPHQL_VALIDATION_FAILED');
		});

		it('login with the right password returns a token', async () => {
			const response = await gql<{ login: { accessToken: string } }>(
				app,
				`mutation ($input: LoginInput!) { login(input: $input) { accessToken } }`,
				{ input: { memberNick: 'e2e_user', memberPassword: PASSWORD } },
			);

			expect(response.data?.login.accessToken).toEqual(expect.any(String));
		});

		it.each([
			['a wrong password', 'e2e_user', 'wrong-password'],
			['an unknown nick', 'e2e_nobody', PASSWORD],
		])('login with %s gets the same UNAUTHENTICATED answer (D-27)', async (_label, memberNick, memberPassword) => {
			const response = await gql(app, `mutation ($input: LoginInput!) { login(input: $input) { _id } }`, {
				input: { memberNick, memberPassword },
			});

			expect(onlyError(response)).toEqual({ code: 'UNAUTHENTICATED', message: Message.INVALID_CREDENTIALS });
		});
	});

	describe('fields the member update inputs must not have (D-14, D-24)', () => {
		it.each([
			['updateMember', 'MemberUpdate', 'memberType', 'ADMIN'],
			['updateMember', 'MemberUpdate', 'memberPassword', '"new-password-1"'],
			['updateMemberByAdmin', 'MemberUpdateByAdmin', 'memberType', 'ADMIN'],
			['updateMemberByAdmin', 'MemberUpdateByAdmin', 'memberPassword', '"new-password-1"'],
		])('%s(input: { %s }) rejects %s as an unknown field', async (operation, _type, field, value) => {
			const idField = operation === 'updateMemberByAdmin' ? `_id: "${user._id}", ` : '';
			const response = await gql(
				app,
				`mutation { ${operation}(input: { ${idField}${field}: ${value} }) { _id } }`,
				{},
				user.token,
			);
			const error = onlyError(response);

			expect(error.code).toBe('GRAPHQL_VALIDATION_FAILED');
			expect(error.message).toContain(`Field "${field}" is not defined`);
		});

		it('the stored type and password are unchanged', async () => {
			expect((await getMember(user._id, user.token)).data?.getMember.memberType).toBe('USER');
			const login = await gql(app, `mutation ($input: LoginInput!) { login(input: $input) { _id } }`, {
				input: { memberNick: 'e2e_user', memberPassword: PASSWORD },
			});
			expect(login.errors).toBeUndefined();
		});
	});

	describe('products', () => {
		const createProduct = (input: Record<string, unknown>, token?: string) =>
			gql<{ createProduct: { _id: string } }>(
				app,
				`mutation ($input: ProductInput!) { createProduct(input: $input) { _id } }`,
				{
					input: {
						productCategory: 'SALES',
						productTitle: 'E2E lead qualifier',
						productImages: ['uploads/product/e2e.png'],
						productDesc: 'Qualifies inbound leads over Telegram for the e2e suite.',
						...input,
					},
				},
				token,
			);

		it('a CREATOR creates a ONE_TIME product with a price; memberProducts becomes 1', async () => {
			const response = await createProduct({ productPricing: 'ONE_TIME', productPrice: 49 }, creator.token);

			expect(response.errors).toBeUndefined();
			productId = response.data!.createProduct._id;
			expect((await getMember(creator._id)).data?.getMember.memberProducts).toBe(1);
		});

		it.each([
			['a USER', 'USER', 'FORBIDDEN', Message.ONLY_SPECIFIC_ROLES_ALLOWED],
			['a guest', undefined, 'UNAUTHENTICATED', Message.TOKEN_NOT_EXIST],
		])('%s cannot create a product (ER rule 1)', async (_label, who, code, message) => {
			const token = who === 'USER' ? user.token : undefined;
			const response = await createProduct({ productPricing: 'FREE', productTitle: 'Not allowed' }, token);

			expect(onlyError(response)).toEqual({ code, message });
		});

		it('a FREE product with a price → BAD_REQUEST PRICE_NOT_ALLOWED (D-03)', async () => {
			const response = await createProduct(
				{ productPricing: 'FREE', productPrice: 10, productTitle: 'Free' },
				creator.token,
			);

			expect(onlyError(response)).toEqual({ code: 'BAD_REQUEST', message: Message.PRICE_NOT_ALLOWED });
		});

		it('a malformed product id → BAD_REQUEST (B18)', async () => {
			expect(onlyError(await getProduct('abc')).code).toBe('BAD_REQUEST');
		});
	});

	describe('filter counts for /agents (D-43)', () => {
		type Facet = { value: string; count: number };
		const facets = (search: Record<string, unknown>) =>
			gql<{ getProductFacets: { categories: Facet[]; pricing: Facet[] } }>(
				app,
				`query ($input: PIsearch!) { getProductFacets(input: $input) { categories { value count } pricing { value count } } }`,
				{ input: search },
			);
		const countOf = (list: Facet[], value: string) => list.find((facet) => facet.value === value)?.count;

		it('a guest gets every category and pricing, counted over ACTIVE products', async () => {
			const response = await facets({});

			expect(response.errors).toBeUndefined();
			const { categories, pricing } = response.data!.getProductFacets;
			expect(categories).toHaveLength(8);
			expect(pricing).toHaveLength(4);
			expect(countOf(categories, 'SALES')).toBe(1);
			expect(countOf(categories, 'MARKETING')).toBe(0);
			expect(countOf(pricing, 'ONE_TIME')).toBe(1);
			expect(countOf(pricing, 'FREE')).toBe(0);
		});

		it('each group ignores its own filter but applies the other one', async () => {
			const { categories, pricing } = (await facets({ categoryList: ['MARKETING'], pricingList: ['ONE_TIME'] })).data!
				.getProductFacets;

			// The SALES product is still counted for its category: the category filter does not apply here...
			expect(countOf(categories, 'SALES')).toBe(1);
			// ...but the MARKETING filter applies to the pricing counts, and nothing is in MARKETING.
			expect(countOf(pricing, 'ONE_TIME')).toBe(0);
		});

		it('a price range drops products outside it (D-03)', async () => {
			const { categories } = (await facets({ pricesRange: { start: 0, end: 10 } })).data!.getProductFacets;

			expect(countOf(categories, 'SALES')).toBe(0);
		});

		it('start greater than end → BAD_REQUEST INVALID_PRICE_RANGE', async () => {
			expect(onlyError(await facets({ pricesRange: { start: 50, end: 5 } }))).toEqual({
				code: 'BAD_REQUEST',
				message: Message.INVALID_PRICE_RANGE,
			});
		});
	});

	describe('contact visibility (D-07, D-23)', () => {
		it('the creator adds an email and a WhatsApp number', async () => {
			const response = await gql(
				app,
				`mutation ($input: MemberUpdate!) { updateMember(input: $input) { memberEmail } }`,
				{ input: { memberEmail: 'creator@e2e.test', memberWhatsapp: '+998900000002' } },
				creator.token,
			);

			expect(response.data).toEqual({ updateMember: { memberEmail: 'creator@e2e.test' } });
		});

		it('a guest gets the contact fields as null, on the product and on the profile', async () => {
			const product = await getProduct(productId);
			const profile = await getMember(creator._id);

			expect(product.data?.getProduct.memberData).toEqual({
				memberNick: 'e2e_creator',
				memberEmail: null,
				memberWhatsapp: null,
			});
			expect(profile.data?.getMember).toMatchObject({ memberEmail: null, memberWhatsapp: null });
		});

		it('a logged-in member gets them', async () => {
			const product = await getProduct(productId, user.token);

			expect(product.data?.getProduct.memberData).toEqual({
				memberNick: 'e2e_creator',
				memberEmail: 'creator@e2e.test',
				memberWhatsapp: '+998900000002',
			});
		});
	});

	describe('getMe (D-33)', () => {
		it('a guest → UNAUTHENTICATED', async () => {
			expect(onlyError(await getMe())).toEqual({ code: 'UNAUTHENTICATED', message: Message.TOKEN_NOT_EXIST });
		});

		it('an active member gets their own profile, with their contacts (D-07, D-23)', async () => {
			const response = await getMe(creator.token);

			expect(response.data?.getMe).toMatchObject({
				_id: creator._id,
				memberNick: 'e2e_creator',
				memberType: 'CREATOR',
				memberStatus: 'ACTIVE',
				memberEmail: 'creator@e2e.test',
				memberWhatsapp: '+998900000002',
				accessToken: null,
			});
		});
	});

	describe('a paused product (D-16)', () => {
		const updateProduct = (input: Record<string, unknown>, token: string) =>
			gql<{ updateProduct: { productStatus: string } }>(
				app,
				`mutation ($input: ProductUpdate!) { updateProduct(input: $input) { productStatus } }`,
				{ input: { _id: productId, ...input } },
				token,
			);
		const listedIds = async (token?: string) => {
			const response = await gql<{ getProducts: { list: Array<{ _id: string }> } }>(
				app,
				`query { getProducts(input: { page: 1, limit: 50, search: {} }) { list { _id } } }`,
				{},
				token,
			);
			return response.data!.getProducts.list.map((product) => product._id);
		};

		it('is hidden from guests and other members, like a missing product', async () => {
			expect((await updateProduct({ productStatus: 'PAUSED' }, creator.token)).data?.updateProduct.productStatus).toBe(
				'PAUSED',
			);

			expect(onlyError(await getProduct(productId))).toEqual({ code: 'NOT_FOUND', message: Message.NO_DATA_FOUND });
			expect(onlyError(await getProduct(productId, user.token)).code).toBe('NOT_FOUND');
			expect(await listedIds()).not.toContain(productId);
		});

		it('is still visible to its owner', async () => {
			expect((await getProduct(productId, creator.token)).data?.getProduct.productStatus).toBe('PAUSED');
		});

		it('is listed again after resuming; memberProducts never changed', async () => {
			await updateProduct({ productStatus: 'ACTIVE' }, creator.token);

			expect(await listedIds()).toContain(productId);
			expect((await getMember(creator._id)).data?.getMember.memberProducts).toBe(1);
		});
	});

	describe('briefs', () => {
		const createBrief = (input: Record<string, unknown>, token: string) =>
			gql<{ createBrief: { _id: string } }>(
				app,
				`mutation ($input: BriefInput!) { createBrief(input: $input) { _id } }`,
				{
					input: {
						briefCategory: 'CUSTOMER_SUPPORT',
						briefTitle: 'E2E support bot',
						briefContent: 'Answer order questions in Telegram, around the clock.',
						...input,
					},
				},
				token,
			);
		const openBriefIds = async () => {
			const response = await gql<{ getBriefs: { list: Array<{ _id: string }> } }>(
				app,
				`query { getBriefs(input: { page: 1, limit: 50, search: {} }) { list { _id } } }`,
			);
			return response.data!.getBriefs.list.map((brief) => brief._id);
		};

		it('a USER creates a brief; memberBriefs becomes 1', async () => {
			const response = await createBrief({ briefBudget: 300 }, user.token);

			expect(response.errors).toBeUndefined();
			briefId = response.data!.createBrief._id;
			expect((await getMember(user._id)).data?.getMember.memberBriefs).toBe(1);
		});

		it('a CREATOR cannot create a brief (ER rule 2)', async () => {
			expect(onlyError(await createBrief({}, creator.token))).toEqual({
				code: 'FORBIDDEN',
				message: Message.ONLY_SPECIFIC_ROLES_ALLOWED,
			});
		});

		it('a past deadline → BAD_REQUEST DEADLINE_IN_PAST (D-05)', async () => {
			const response = await createBrief({ briefDeadline: '2000-01-01T00:00:00.000Z' }, user.token);

			expect(onlyError(response)).toEqual({ code: 'BAD_REQUEST', message: Message.DEADLINE_IN_PAST });
		});

		it('a closed brief stays readable by guests, but leaves the public list (D-30)', async () => {
			expect(await openBriefIds()).toContain(briefId);
			const close = await gql(
				app,
				`mutation ($input: BriefUpdate!) { updateBrief(input: $input) { briefStatus } }`,
				{ input: { _id: briefId, briefStatus: 'CLOSED' } },
				user.token,
			);

			expect(close.data).toEqual({ updateBrief: { briefStatus: 'CLOSED' } });
			expect((await getBrief(briefId)).data?.getBrief.briefStatus).toBe('CLOSED');
			expect(await openBriefIds()).not.toContain(briefId);
		});
	});

	// briefId is CLOSED here (the 'briefs' block closed it): closed briefs stay readable, so they can be saved (D-30)
	describe('saved briefs (D-47)', () => {
		type SavedBrief = { _id: string; meSaved: boolean | null };
		const saveCall = (operation: 'saveBrief' | 'unsaveBrief', id: string, token?: string) =>
			gql<Record<string, SavedBrief>>(
				app,
				`mutation ($id: String!) { ${operation}(briefId: $id) { _id meSaved } }`,
				{ id },
				token,
			);
		const savedList = async (token: string) => {
			const response = await gql<{
				getSavedBriefs: {
					list: Array<{ _id: string; briefStatus: string; meSaved: boolean | null }>;
					metaCounter: Array<{ total: number }>;
				};
			}>(
				app,
				`query { getSavedBriefs(input: { page: 1, limit: 10 }) { list { _id briefStatus meSaved } metaCounter { total } } }`,
				{},
				token,
			);
			expect(response.errors).toBeUndefined();
			return response.data!.getSavedBriefs;
		};
		const meSavedOnDetail = async (token?: string) =>
			(
				await gql<{ getBrief: SavedBrief }>(
					app,
					`query ($id: String!) { getBrief(briefId: $id) { _id meSaved } }`,
					{ id: briefId },
					token,
				)
			).data!.getBrief.meSaved;
		const meSavedInClosedList = async (token?: string) => {
			const response = await gql<{ getBriefs: { list: SavedBrief[] } }>(
				app,
				`query { getBriefs(input: { page: 1, limit: 50, search: { briefStatus: CLOSED } }) { list { _id meSaved } } }`,
				{},
				token,
			);
			return response.data!.getBriefs.list.find((brief) => brief._id === briefId)?.meSaved;
		};

		it('a guest cannot save → UNAUTHENTICATED; meSaved is null for guests', async () => {
			expect(onlyError(await saveCall('saveBrief', briefId)).code).toBe('UNAUTHENTICATED');
			expect(await meSavedOnDetail()).toBeNull();
			expect(await meSavedInClosedList()).toBeNull();
		});

		it('the owner cannot save their own brief → BAD_REQUEST NOT_ALLOWED_REQUEST', async () => {
			expect(onlyError(await saveCall('saveBrief', briefId, user.token))).toEqual({
				code: 'BAD_REQUEST',
				message: Message.NOT_ALLOWED_REQUEST,
			});
			expect(await meSavedOnDetail(user.token)).toBe(false);
		});

		it('a CREATOR saves a CLOSED brief; saving again changes nothing', async () => {
			for (let attempt = 0; attempt < 2; attempt++) {
				const response = await saveCall('saveBrief', briefId, creator.token);
				expect(response.errors).toBeUndefined();
				expect(response.data?.saveBrief).toEqual({ _id: briefId, meSaved: true });
			}

			expect(await savedList(creator.token)).toEqual({
				list: [{ _id: briefId, briefStatus: 'CLOSED', meSaved: true }],
				metaCounter: [{ total: 1 }],
			});
			expect(await connection.collection('saves').countDocuments({})).toBe(1);
			expect(await meSavedOnDetail(creator.token)).toBe(true);
			expect(await meSavedInClosedList(creator.token)).toBe(true);
		});

		it("the save is private: the owner's own saved list stays empty", async () => {
			expect(await savedList(user.token)).toEqual({ list: [], metaCounter: [] });
		});

		it('unsaving twice changes nothing; the list is empty again', async () => {
			for (let attempt = 0; attempt < 2; attempt++) {
				const response = await saveCall('unsaveBrief', briefId, creator.token);
				expect(response.errors).toBeUndefined();
				expect(response.data?.unsaveBrief).toEqual({ _id: briefId, meSaved: false });
			}

			expect(await savedList(creator.token)).toEqual({ list: [], metaCounter: [] });
			expect(await meSavedOnDetail(creator.token)).toBe(false);
		});
	});

	describe('/briefs filters, counts and live badge (D-44)', () => {
		// After 'briefs': the first brief is CLOSED. These add three OPEN ones: one open to offers without a deadline,
		// one with a fixed budget and a future deadline, and one whose deadline is then moved into the past.
		const ids = { offers: '', upcoming: '', passed: '' };
		type Facet = { value: string; count: number };
		const countOf = (list: Facet[], value: string) => list.find((facet) => facet.value === value)?.count;

		const create = async (input: Record<string, unknown>) => {
			const response = await gql<{ createBrief: { _id: string } }>(
				app,
				`mutation ($input: BriefInput!) { createBrief(input: $input) { _id } }`,
				{ input: { briefContent: 'An agent for our team, details in the comments.', ...input } },
				user.token,
			);
			expect(response.errors).toBeUndefined();
			return response.data!.createBrief._id;
		};
		const briefIds = async (search: Record<string, unknown>, sort?: string, direction?: string) => {
			const response = await gql<{ getBriefs: { list: Array<{ _id: string }> } }>(
				app,
				`query ($input: BriefsInquiry!) { getBriefs(input: $input) { list { _id } } }`,
				{ input: { page: 1, limit: 50, sort, direction, search } },
			);
			expect(response.errors).toBeUndefined();
			return response.data!.getBriefs.list.map((brief) => brief._id);
		};
		const facets = async (search: Record<string, unknown>) => {
			const response = await gql<{ getBriefFacets: { categories: Facet[]; budgetTypes: Facet[]; statuses: Facet[] } }>(
				app,
				`query ($input: BISearch!) { getBriefFacets(input: $input) { categories { value count } budgetTypes { value count } statuses { value count } } }`,
				{ input: search },
			);
			expect(response.errors).toBeUndefined();
			return response.data!.getBriefFacets;
		};
		const stats = async () => {
			const response = await gql<{ getOpenBriefStats: { openNow: number; budgetTotal: number } }>(
				app,
				`query { getOpenBriefStats { openNow budgetTotal } }`,
			);
			expect(response.errors).toBeUndefined();
			return response.data!.getOpenBriefStats;
		};

		it('a guest sees the live badge: open briefs and the sum of their fixed budgets', async () => {
			ids.offers = await create({ briefCategory: 'SALES', briefTitle: 'E2E cart follow-ups' });
			ids.upcoming = await create({
				briefCategory: 'CUSTOMER_SUPPORT',
				briefTitle: 'E2E shipping answers',
				briefBudget: 199.99,
				briefDeadline: '2100-01-01T00:00:00.000Z',
			});
			ids.passed = await create({
				briefCategory: 'CUSTOMER_SUPPORT',
				briefTitle: 'E2E weekly report',
				briefBudget: 50,
				briefDeadline: '2100-06-01T00:00:00.000Z',
			});

			expect(await stats()).toEqual({ openNow: 3, budgetTotal: 249.99 });
		});

		it('a passed deadline leaves the badge and, with hidePastDeadline, the open list', async () => {
			// The API never accepts a past deadline (D-05); time passing is simulated in the database.
			await connection
				.collection('briefs')
				.updateOne({ _id: new Types.ObjectId(ids.passed) }, { $set: { briefDeadline: new Date('2001-01-01') } });

			expect(await stats()).toEqual({ openNow: 2, budgetTotal: 199.99 });
			expect(await briefIds({ hidePastDeadline: true })).not.toContain(ids.passed);
			expect(await briefIds({})).toContain(ids.passed);
		});

		it('filters by budget type', async () => {
			expect(await briefIds({ budgetTypeList: ['OPEN_TO_OFFERS'] })).toEqual([ids.offers]);
			expect(await briefIds({ budgetTypeList: ['FIXED'], hidePastDeadline: true })).toEqual([ids.upcoming]);
		});

		it('counts each group without its own filter; CLOSED briefs ignore hidePastDeadline', async () => {
			const all = await facets({ hidePastDeadline: true });
			expect(countOf(all.statuses, 'OPEN')).toBe(2);
			expect(countOf(all.statuses, 'CLOSED')).toBe(1);
			expect(countOf(all.budgetTypes, 'FIXED')).toBe(1);
			expect(countOf(all.budgetTypes, 'OPEN_TO_OFFERS')).toBe(1);
			expect(countOf(all.categories, 'CUSTOMER_SUPPORT')).toBe(1);

			const sales = await facets({ hidePastDeadline: true, categoryList: ['SALES'] });
			expect(countOf(sales.categories, 'CUSTOMER_SUPPORT')).toBe(1);
			expect(countOf(sales.budgetTypes, 'FIXED')).toBe(0);
			expect(countOf(sales.budgetTypes, 'OPEN_TO_OFFERS')).toBe(1);
		});

		it('"deadline soonest" lists upcoming, then passed, then no deadline', async () => {
			expect(await briefIds({}, 'briefDeadline', 'ASC')).toEqual([ids.upcoming, ids.passed, ids.offers]);
		});

		it('getBriefFacets rejects DELETE like getBriefs (D-30)', async () => {
			const response = await gql(
				app,
				`query { getBriefFacets(input: { briefStatus: DELETE }) { statuses { count } } }`,
			);

			expect(onlyError(response)).toEqual({ code: 'BAD_REQUEST', message: Message.NO_DATA_FOUND });
		});
	});

	describe('/creators list, counts and hero (D-45)', () => {
		// Here: e2e_creator has 1 ACTIVE SALES agent. This adds a creator without agents (e2e_maker), a USER (e2e_fan)
		// who follows e2e_maker, and a PAUSED agent for e2e_creator. The fan follows e2e_maker, not e2e_creator: later
		// blocks count e2e_creator's followers and must not see this one.
		const fan = { token: '' };
		const maker = { _id: '' };
		type Creator = {
			memberNick: string;
			memberProducts: number;
			memberActiveProducts: number;
			memberCategories: string[];
			memberTopProducts: Array<{ productTitle: string; productCategory: string; productPrice: number | null }>;
			meFollowed: Array<{ myFollowing: boolean }> | null;
		};
		const creators = async (
			search: Record<string, unknown>,
			token?: string,
			sort = 'memberRank',
			direction = 'DESC',
		) => {
			const response = await gql<{ getCreators: { list: Creator[]; metaCounter: Array<{ total: number }> } }>(
				app,
				`query ($input: CreatorsInquiry!) { getCreators(input: $input) {
					list { memberNick memberProducts memberActiveProducts memberCategories
						memberTopProducts { productTitle productCategory productPrice } meFollowed { myFollowing } }
					metaCounter { total } } }`,
				{ input: { page: 1, limit: 50, sort, direction, search } },
				token,
			);
			expect(response.errors).toBeUndefined();
			return response.data!.getCreators.list;
		};
		const nicks = async (search: Record<string, unknown>, token?: string, sort?: string, direction?: string) =>
			(await creators(search, token, sort, direction)).map((creator) => creator.memberNick);
		const facets = async (search: Record<string, unknown>, token?: string) => {
			const response = await gql<{
				getCreatorFacets: {
					categories: Array<{ value: string; count: number }>;
					all: number;
					withoutAgents: number;
					following: number;
				};
			}>(
				app,
				`query ($input: CRISearch!) { getCreatorFacets(input: $input) { categories { value count } all withoutAgents following } }`,
				{ input: search },
				token,
			);
			expect(response.errors).toBeUndefined();
			return response.data!.getCreatorFacets;
		};

		it('sets up a creator without agents (e2e_maker) and a USER who will follow (e2e_fan)', async () => {
			const makerSignup = await signup('e2e_maker', 'CREATOR', '+998900000021');
			expect(makerSignup.errors).toBeUndefined();
			maker._id = makerSignup.data!.signup._id;
			const fanSignup = await signup('e2e_fan', 'USER', '+998900000022');
			expect(fanSignup.errors).toBeUndefined();
			fan.token = fanSignup.data!.signup.accessToken;
		});

		it('counts ACTIVE agents only; memberProducts still counts the paused one (D-16)', async () => {
			const paused = await gql<{ createProduct: { _id: string } }>(
				app,
				`mutation ($input: ProductInput!) { createProduct(input: $input) { _id } }`,
				{
					input: {
						productCategory: 'EDUCATION',
						productTitle: 'E2E paused tutor',
						productImages: ['uploads/product/e2e.png'],
						productDesc: 'Explains homework step by step for school students.',
						productPricing: 'FREE',
					},
				},
				creator.token,
			);
			expect(paused.errors).toBeUndefined();
			await gql(
				app,
				`mutation ($input: ProductUpdate!) { updateProduct(input: $input) { _id } }`,
				{ input: { _id: paused.data!.createProduct._id, productStatus: 'PAUSED' } },
				creator.token,
			);

			const [card] = (await creators({ text: 'e2e_creator' })).filter((item) => item.memberNick === 'e2e_creator');
			expect(card).toMatchObject({ memberProducts: 2, memberActiveProducts: 1, memberCategories: ['SALES'] });
			expect(card.memberTopProducts).toEqual([
				{ productTitle: 'E2E lead qualifier', productCategory: 'SALES', productPrice: 49 },
			]);
		});

		it('withAgentsOnly hides creators without an ACTIVE agent; the facets say how many', async () => {
			expect(await nicks({})).toEqual(expect.arrayContaining(['e2e_creator', 'e2e_maker']));
			expect(await nicks({ withAgentsOnly: true })).toEqual(['e2e_creator']);

			const counts = await facets({ withAgentsOnly: true });
			expect(counts.withoutAgents).toBe(1);
			expect(counts.all).toBe(1);
			expect(counts.categories.find((facet) => facet.value === 'SALES')?.count).toBe(1);
			// the paused EDUCATION agent does not count
			expect(counts.categories.find((facet) => facet.value === 'EDUCATION')?.count).toBe(0);
		});

		it('searches agent titles, and filters by category', async () => {
			expect(await nicks({ text: 'lead qualifier' })).toEqual(['e2e_creator']);
			expect(await nicks({ text: 'paused tutor' })).toEqual([]);
			expect(await nicks({ categoryList: ['SALES'] })).toEqual(['e2e_creator']);
			expect(await nicks({ categoryList: ['EDUCATION'] })).toEqual([]);
		});

		it('followingOnly: the creators the caller follows; a guest gets none', async () => {
			const follow = await gql(
				app,
				`mutation ($id: String!) { subscribe(input: $id) { _id } }`,
				{ id: maker._id },
				fan.token,
			);
			expect(follow.errors).toBeUndefined();

			expect(await nicks({ followingOnly: true }, fan.token)).toEqual(['e2e_maker']);
			// both filters together: e2e_maker has no ACTIVE agent
			expect(await nicks({ followingOnly: true, withAgentsOnly: true }, fan.token)).toEqual([]);
			expect(await nicks({ followingOnly: true })).toEqual([]);
			expect((await facets({}, fan.token)).following).toBe(1);
			const [card] = await creators({ followingOnly: true }, fan.token);
			expect(card.meFollowed).toEqual([{ myFollowing: true }]);
		});

		it('sorts by name and by ACTIVE agents', async () => {
			const byName = await nicks({}, undefined, 'creatorName', 'ASC');
			expect(byName.indexOf('e2e_creator')).toBeLessThan(byName.indexOf('e2e_maker'));
			const byAgents = await nicks({}, undefined, 'creatorProducts', 'DESC');
			expect(byAgents.indexOf('e2e_creator')).toBeLessThan(byAgents.indexOf('e2e_maker'));
		});

		it('getCreatorStats: ACTIVE creators, their ACTIVE agents, faces with agents only', async () => {
			const response = await gql<{
				getCreatorStats: {
					creators: number;
					agents: number;
					faces: Array<{ memberNick: string; memberCategories: string[] }>;
				};
			}>(app, `query { getCreatorStats { creators agents faces { memberNick memberCategories } } }`);

			expect(response.errors).toBeUndefined();
			expect(response.data!.getCreatorStats).toEqual({
				creators: 2,
				agents: 1,
				faces: [{ memberNick: 'e2e_creator', memberCategories: ['SALES'] }],
			});
		});
	});

	describe('/community search, topic counts and writers (D-46)', () => {
		// e2e_user writes two articles, e2e_creator one; e2e_user likes e2e_creator's and e2e_creator comments on one of
		// e2e_user's. Nothing later counts articles, likes on articles or article comments.
		const ids = { tips: '', launch: '', jokes: '' };
		type Facets = { categories: Array<{ value: string; count: number }>; all: number };

		const write = async (token: string, articleCategory: string, articleTitle: string, articleContent: string) => {
			const response = await gql<{ createBoardArticle: { _id: string } }>(
				app,
				`mutation ($input: BoardArticleInput!) { createBoardArticle(input: $input) { _id } }`,
				{ input: { articleCategory, articleTitle, articleContent } },
				token,
			);
			expect(response.errors).toBeUndefined();
			return response.data!.createBoardArticle._id;
		};
		const titles = async (search: Record<string, unknown>, sort?: string) => {
			const response = await gql<{ getBoardArticles: { list: Array<{ articleTitle: string }> } }>(
				app,
				`query ($input: BoardArticlesInquiry!) { getBoardArticles(input: $input) { list { articleTitle } } }`,
				{ input: { page: 1, limit: 50, sort, direction: 'DESC', search } },
			);
			expect(response.errors).toBeUndefined();
			return response.data!.getBoardArticles.list.map((article) => article.articleTitle);
		};
		const facets = async (search: Record<string, unknown>) => {
			const response = await gql<{ getArticleFacets: Facets }>(
				app,
				`query ($input: BAISearch!) { getArticleFacets(input: $input) { categories { value count } all } }`,
				{ input: search },
			);
			expect(response.errors).toBeUndefined();
			return response.data!.getArticleFacets;
		};

		it('sets up three articles, a like and a comment', async () => {
			ids.tips = await write(user.token, 'FREE', 'Prompt tips', 'Short prompts work better for support bots.');
			ids.launch = await write(user.token, 'NEWS', 'HelpDesk launch', 'Our team shipped a new release today.');
			ids.jokes = await write(creator.token, 'HUMOR', 'Agent jokes', 'Why did the agent cross the road?');

			const like = await gql(
				app,
				`mutation ($id: String!) { likeTargetBoardArticle(articleId: $id) { _id } }`,
				{ id: ids.jokes },
				user.token,
			);
			expect(like.errors).toBeUndefined();
			const comment = await gql(
				app,
				`mutation ($input: CommentInput!) { createComment(input: $input) { _id } }`,
				{ input: { commentGroup: 'ARTICLE', commentRefId: ids.launch, commentContent: 'Congrats!' } },
				creator.token,
			);
			expect(comment.errors).toBeUndefined();
		});

		it('the text search matches the title, the content and the author nick', async () => {
			expect(await titles({ text: 'helpdesk' })).toEqual(['HelpDesk launch']);
			expect(await titles({ text: 'support bots' })).toEqual(['Prompt tips']);
			expect(await titles({ text: 'e2e_creator' })).toEqual(['Agent jokes']);
			// the regex is escaped (S8): a "." matches only a dot
			expect(await titles({ text: 'e2e.creator' })).toEqual([]);
		});

		it('sorts by articleComments ("most discussed"); ties keep the newest first', async () => {
			expect(await titles({}, 'articleComments')).toEqual(['HelpDesk launch', 'Agent jokes', 'Prompt tips']);
		});

		it('getArticleFacets: every topic in order, the topic filter ignored, the others applied', async () => {
			const counts = await facets({ articleCategory: 'NEWS' });
			expect(counts).toEqual({
				categories: [
					{ value: 'FREE', count: 1 },
					{ value: 'RECOMMEND', count: 0 },
					{ value: 'NEWS', count: 1 },
					{ value: 'HUMOR', count: 1 },
				],
				all: 3,
			});
			expect((await facets({ memberId: user._id, text: 'e' })).all).toBe(2);
		});

		it('getCommunityStats: articles, writers and the most liked writer first', async () => {
			const response = await gql<{
				getCommunityStats: {
					articles: number;
					writers: number;
					topWriters: Array<{ memberData: { memberNick: string }; articles: number; likes: number }>;
				};
			}>(
				app,
				`query { getCommunityStats { articles writers topWriters { memberData { memberNick } articles likes } } }`,
			);

			expect(response.errors).toBeUndefined();
			expect(response.data!.getCommunityStats).toEqual({
				articles: 3,
				writers: 2,
				topWriters: [
					{ memberData: { memberNick: 'e2e_creator' }, articles: 1, likes: 1 },
					{ memberData: { memberNick: 'e2e_user' }, articles: 2, likes: 0 },
				],
			});
		});
	});

	describe('who viewed your profile (D-42, B24)', () => {
		const visitor = { _id: '', token: '' };
		const moderator = { _id: '', token: '' };
		type Visitors = {
			getProfileVisitors: {
				list: Array<{ visitor: { memberNick: string; memberBrowsePrivately: boolean | null }; visitedAt: string }>;
				metaCounter: Array<{ total: number }>;
				privateCount: number;
			};
		};
		const visitorsOf = (token?: string) =>
			gql<Visitors>(
				app,
				`query ($input: OrdinaryInquiry!) { getProfileVisitors(input: $input) {
					list { visitor { memberNick memberBrowsePrivately } visitedAt } metaCounter { total } privateCount } }`,
				{ input: { page: 1, limit: 20 } },
				token,
			);
		const profileViews = async () =>
			(
				await gql<{ getMember: { memberViews: number } }>(
					app,
					`query ($id: String!) { getMember(memberId: $id) { memberViews } }`,
					{ id: creator._id },
				)
			).data!.getMember.memberViews;
		const visitOf = (list: Visitors['getProfileVisitors']['list'], nick: string) =>
			list.find((item) => item.visitor.memberNick === nick);

		beforeAll(async () => {
			const visitorSignup = await signup('e2e_visitor', 'USER', '+998900000011');
			Object.assign(visitor, visitorSignup.data!.signup);
			visitor.token = visitorSignup.data!.signup.accessToken;

			// admins are created by script only (D-14): promote a member in the DB, then log in for an ADMIN token
			const moderatorSignup = await signup('e2e_mod', 'USER', '+998900000012');
			moderator._id = moderatorSignup.data!.signup._id;
			await connection.collection('members').updateOne({ memberNick: 'e2e_mod' }, { $set: { memberType: 'ADMIN' } });
			moderator.token = (await login('e2e_mod')).data!.login.accessToken;
		});

		it('a repeat visit counts once but moves the visit to "now" (B24)', async () => {
			const before = await profileViews();
			await getMember(creator._id, visitor.token);
			const first = visitOf((await visitorsOf(creator.token)).data!.getProfileVisitors.list, 'e2e_visitor');

			await new Promise((resolve) => setTimeout(resolve, 20));
			await getMember(creator._id, visitor.token);
			const second = visitOf((await visitorsOf(creator.token)).data!.getProfileVisitors.list, 'e2e_visitor');

			expect(await profileViews()).toBe(before + 1);
			expect(first).toBeDefined();
			expect(new Date(second!.visitedAt).getTime()).toBeGreaterThan(new Date(first!.visitedAt).getTime());
		});

		it("the owner sees the visitor, but not the visitor's private setting", async () => {
			const visitors = (await visitorsOf(creator.token)).data!.getProfileVisitors;

			expect(visitOf(visitors.list, 'e2e_visitor')).toMatchObject({ visitor: { memberBrowsePrivately: null } });
			expect(visitors.privateCount).toBe(0);
		});

		it("an ADMIN's visit is never recorded or counted, and admins have no visitors page", async () => {
			const before = await profileViews();
			await getMember(creator._id, moderator.token);

			expect(await profileViews()).toBe(before);
			expect(visitOf((await visitorsOf(creator.token)).data!.getProfileVisitors.list, 'e2e_mod')).toBeUndefined();
			expect(onlyError(await visitorsOf(moderator.token)).code).toBe('FORBIDDEN');
		});

		it('a guest → UNAUTHENTICATED', async () => {
			expect(onlyError(await visitorsOf()).code).toBe('UNAUTHENTICATED');
		});

		it('browsing privately hides the visitor from the list; they are only counted', async () => {
			const update = await gql<{ updateMember: { memberBrowsePrivately: boolean } }>(
				app,
				`mutation ($input: MemberUpdate!) { updateMember(input: $input) { memberBrowsePrivately } }`,
				{ input: { memberBrowsePrivately: true } },
				visitor.token,
			);
			const visitors = (await visitorsOf(creator.token)).data!.getProfileVisitors;

			expect(update.data).toEqual({ updateMember: { memberBrowsePrivately: true } });
			expect(visitOf(visitors.list, 'e2e_visitor')).toBeUndefined();
			expect(visitors.privateCount).toBe(1);
		});
	});

	describe('comments of a deleted member (D-38)', () => {
		let commentId = '';
		const memberComments = () =>
			gql<{
				getComments: { list: Array<{ _id: string; memberId: string; memberData: { memberNick: string } | null }> };
			}>(
				app,
				`query ($input: CommentsInquiry!) { getComments(input: $input) { list { _id memberId memberData { memberNick } } } }`,
				{ input: { page: 1, limit: 10, search: { commentRefId: creator._id, commentGroup: 'MEMBER' } } },
			);

		it('a member comments on a profile', async () => {
			const response = await gql<{ createComment: { _id: string } }>(
				app,
				`mutation ($input: CommentInput!) { createComment(input: $input) { _id } }`,
				{ input: { commentGroup: 'MEMBER', commentRefId: creator._id, commentContent: 'Great creator!' } },
				user.token,
			);

			expect(response.errors).toBeUndefined();
			commentId = response.data!.createComment._id;
			const follow = await gql(
				app,
				`mutation ($id: String!) { subscribe(input: $id) { _id } }`,
				{ id: creator._id },
				user.token,
			);
			expect(follow.errors).toBeUndefined();
			expect((await memberComments()).data?.getComments.list[0].memberData?.memberNick).toBe('e2e_user');
		});

		it('after the author is deleted, the comment stays with memberData null (no link to a 404 profile)', async () => {
			await connection
				.collection('members')
				.updateOne({ memberNick: 'e2e_user' }, { $set: { memberStatus: 'DELETE' } });

			const list = (await memberComments()).data?.getComments.list;
			expect(list).toEqual([{ _id: commentId, memberId: user._id, memberData: null }]);
			expect(onlyError(await getMember(user._id)).code).toBe('NOT_FOUND');
		});

		it('a follow left behind (a delete straight in the DB, not D-39) never breaks the list: followerData null', async () => {
			const followers = await gql<{
				getMemberFollowers: { list: Array<{ followerId: string; followerData: unknown }> };
			}>(
				app,
				`query ($input: FollowInquiry!) { getMemberFollowers(input: $input) { list { followerId followerData { memberNick } } } }`,
				{ input: { page: 1, limit: 10, search: { followingId: creator._id } } },
			);

			expect(followers.errors).toBeUndefined();
			expect(followers.data?.getMemberFollowers.list).toEqual([{ followerId: user._id, followerData: null }]);
		});
	});

	describe('a blocked member (B17)', () => {
		beforeAll(async () => {
			await connection
				.collection('members')
				.updateOne({ memberNick: 'e2e_creator' }, { $set: { memberStatus: 'BLOCK' } });
		});

		it('is rejected by guarded operations, although the token is still valid', async () => {
			const response = await gql(
				app,
				`mutation ($input: ProductUpdate!) { updateProduct(input: $input) { _id } }`,
				{ input: { _id: productId, productTitle: 'Renamed while blocked' } },
				creator.token,
			);

			expect(onlyError(response)).toEqual({ code: 'FORBIDDEN', message: Message.BLOCKED_USER });
		});

		it.each([
			['getMe', () => getMe(creator.token)],
			['login with the right password', () => login('e2e_creator')],
		])('%s → FORBIDDEN with extensions.reason MEMBER_BLOCKED (D-33)', async (_label, call) => {
			const response = await call();

			expect(onlyError(response)).toEqual({ code: 'FORBIDDEN', message: Message.BLOCKED_USER });
			expect(response.errors![0].extensions).toEqual({ code: 'FORBIDDEN', reason: ErrorReason.MEMBER_BLOCKED });
		});

		it('is a guest on public reads: contact fields are null', async () => {
			const product = await getProduct(productId, creator.token);

			expect(product.data?.getProduct.memberData).toMatchObject({ memberEmail: null, memberWhatsapp: null });
		});
	});
	// own members and brief: the blocks above count briefs and members, and the creator is blocked by now
	describe('offers on briefs and invites (D-48)', () => {
		const owner = { _id: '', token: '' };
		const maker = { _id: '', token: '' };
		const rival = { _id: '', token: '' };
		let offerBriefId = '';
		let makerOfferId = '';
		let rivalOfferId = '';

		type OfferView = { _id: string; offerStatus: string; offerMessage: string; expiresAt: string | null };
		const OFFER = '_id offerStatus offerMessage expiresAt';

		const sendOffer = (token: string, fields: Record<string, unknown> = {}) =>
			gql<{ createOffer: OfferView }>(
				app,
				`mutation ($input: OfferInput!) { createOffer(input: $input) { ${OFFER} } }`,
				{
					input: {
						briefId: offerBriefId,
						offerPrice: 300,
						offerDeliveryDays: 7,
						offerMessage: '   I built three support bots like this one.   ',
						...fields,
					},
				},
				token,
			);
		const moveOffer = (operation: 'acceptOffer' | 'declineOffer' | 'withdrawOffer', id: string, token: string) =>
			gql<Record<string, OfferView>>(
				app,
				`mutation ($id: String!) { ${operation}(offerId: $id) { ${OFFER} } }`,
				{ id },
				token,
			);
		const getOffer = (id: string, token: string) =>
			gql<{ getOffer: OfferView }>(app, `query ($id: String!) { getOffer(offerId: $id) { ${OFFER} } }`, { id }, token);
		const briefView = async (token?: string) => {
			const response = await gql<{
				getBrief: {
					briefOffers: number;
					meInvited: boolean | null;
					meOffer: { _id: string; offerStatus: string } | null;
				};
			}>(
				app,
				`query ($id: String!) { getBrief(briefId: $id) { briefOffers meInvited meOffer { _id offerStatus } } }`,
				{ id: offerBriefId },
				token,
			);
			expect(response.errors).toBeUndefined();
			return response.data!.getBrief;
		};
		const briefOffers = async () => (await briefView()).briefOffers;
		const ownerList = async () => {
			const response = await gql<{
				getBriefOffers: {
					list: Array<{ _id: string; offerStatus: string; invited: boolean }>;
					metaCounter: Array<{ total: number }>;
				};
			}>(
				app,
				`query ($id: String!) { getBriefOffers(input: { page: 1, limit: 10, search: { briefId: $id } }) { list { _id offerStatus invited } metaCounter { total } } }`,
				{ id: offerBriefId },
				owner.token,
			);
			expect(response.errors).toBeUndefined();
			return response.data!.getBriefOffers;
		};
		const setBriefStatus = (briefStatus: string) =>
			gql(
				app,
				`mutation ($input: BriefUpdate!) { updateBrief(input: $input) { briefStatus } }`,
				{ input: { _id: offerBriefId, briefStatus } },
				owner.token,
			);

		beforeAll(async () => {
			for (const [member, nick, type, phone] of [
				[owner, 'e2e_offer_owner', 'USER', '+998900000031'],
				[maker, 'e2e_offer_maker', 'CREATOR', '+998900000032'],
				[rival, 'e2e_offer_rival', 'CREATOR', '+998900000033'],
			] as const) {
				const response = await signup(nick, type, phone);
				member._id = response.data!.signup._id;
				member.token = response.data!.signup.accessToken;
			}
			const brief = await gql<{ createBrief: { _id: string } }>(
				app,
				`mutation ($input: BriefInput!) { createBrief(input: $input) { _id } }`,
				{
					input: {
						briefCategory: 'CUSTOMER_SUPPORT',
						briefTitle: 'E2E offers brief',
						briefContent: 'A support bot for a bakery, in Uzbek and Russian.',
					},
				},
				owner.token,
			);
			offerBriefId = brief.data!.createBrief._id;
		});

		it('a brief stored without briefOffers answers 0', async () => {
			await connection
				.collection('briefs')
				.updateOne({ _id: new Types.ObjectId(offerBriefId) }, { $unset: { briefOffers: '' } });
			expect(await briefOffers()).toBe(0);
		});

		it('a USER cannot send an offer → FORBIDDEN', async () => {
			expect(onlyError(await sendOffer(owner.token))).toEqual({
				code: 'FORBIDDEN',
				message: Message.ONLY_SPECIFIC_ROLES_ALLOWED,
			});
		});

		it('a CREATOR sends one: PENDING, trimmed, 14 days to answer; briefOffers 1', async () => {
			const response = await sendOffer(maker.token);

			expect(response.errors).toBeUndefined();
			const offer = response.data!.createOffer;
			makerOfferId = offer._id;
			expect(offer.offerStatus).toBe('PENDING');
			expect(offer.offerMessage).toBe('I built three support bots like this one.');
			const days = (new Date(offer.expiresAt!).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
			expect(days).toBeGreaterThan(13.9);
			expect(days).toBeLessThanOrEqual(14);
			expect(await briefOffers()).toBe(1);
		});

		it('sending again while PENDING → OFFER_ALREADY_PENDING; still one document', async () => {
			expect(onlyError(await sendOffer(maker.token))).toEqual({
				code: 'BAD_REQUEST',
				message: Message.OFFER_ALREADY_PENDING,
			});
			expect(await connection.collection('offers').countDocuments({})).toBe(1);
		});

		it('the creator sees their own offer on the brief; another creator sees none', async () => {
			expect((await briefView(maker.token)).meOffer).toEqual({ _id: makerOfferId, offerStatus: 'PENDING' });
			expect((await briefView(rival.token)).meOffer).toBeNull();
			expect((await briefView(owner.token)).meOffer).toBeNull();
		});

		it('only its creator and the brief owner read an offer; another creator gets NOT_FOUND', async () => {
			expect((await getOffer(makerOfferId, owner.token)).errors).toBeUndefined();
			expect((await getOffer(makerOfferId, maker.token)).errors).toBeUndefined();
			expect(onlyError(await getOffer(makerOfferId, rival.token)).message).toBe(Message.NO_DATA_FOUND);
		});

		it('the owner invites a creator; inviting again changes nothing', async () => {
			const invite = () =>
				gql<{ inviteCreator: { _id: string } }>(
					app,
					`mutation ($b: String!, $c: String!) { inviteCreator(briefId: $b, creatorId: $c) { _id } }`,
					{ b: offerBriefId, c: rival._id },
					owner.token,
				);
			const first = await invite();
			const second = await invite();

			expect(first.errors).toBeUndefined();
			expect(second.data?.inviteCreator._id).toBe(first.data?.inviteCreator._id);
			expect((await briefView(rival.token)).meInvited).toBe(true);
			expect((await briefView(maker.token)).meInvited).toBe(false);

			const invites = await gql<{ getMyInvites: { list: Array<{ briefId: string }> } }>(
				app,
				`query { getMyInvites(input: { page: 1, limit: 10 }) { list { briefId } } }`,
				{},
				rival.token,
			);
			expect(invites.data?.getMyInvites.list).toEqual([{ briefId: offerBriefId }]);
		});

		it('the invited creator sends an offer; the owner sees both, the invited one marked', async () => {
			const response = await sendOffer(rival.token, { offerPrice: 250 });
			rivalOfferId = response.data!.createOffer._id;

			const list = await ownerList();
			expect(list.metaCounter).toEqual([{ total: 2 }]);
			expect(list.list).toEqual([
				{ _id: rivalOfferId, offerStatus: 'PENDING', invited: true },
				{ _id: makerOfferId, offerStatus: 'PENDING', invited: false },
			]);
			expect(await briefOffers()).toBe(2);
		});

		it('withdraw, then send again: the same document; briefOffers 1, then 2', async () => {
			const withdrawn = await moveOffer('withdrawOffer', makerOfferId, maker.token);
			expect(withdrawn.data?.withdrawOffer).toMatchObject({ offerStatus: 'WITHDRAWN', expiresAt: null });
			expect(await briefOffers()).toBe(1);

			const again = await sendOffer(maker.token);
			expect(again.data?.createOffer).toMatchObject({ _id: makerOfferId, offerStatus: 'PENDING' });
			expect(await briefOffers()).toBe(2);
			expect(await connection.collection('offers').countDocuments({})).toBe(2);
		});

		it('only the brief owner accepts; ACCEPTED is final and stays counted', async () => {
			expect(onlyError(await moveOffer('acceptOffer', makerOfferId, maker.token)).code).toBe('FORBIDDEN');

			const accepted = await moveOffer('acceptOffer', makerOfferId, owner.token);
			expect(accepted.data?.acceptOffer.offerStatus).toBe('ACCEPTED');
			expect(onlyError(await moveOffer('acceptOffer', makerOfferId, owner.token))).toEqual({
				code: 'BAD_REQUEST',
				message: Message.INVALID_OFFER_STATUS_CHANGE,
			});
			expect(await briefOffers()).toBe(2);
		});

		it('closing the brief declines its PENDING offers; reopening lets their creators send again', async () => {
			expect((await setBriefStatus('CLOSED')).errors).toBeUndefined();
			const declined = await getOffer(rivalOfferId, rival.token);
			expect(declined.data?.getOffer.offerStatus).toBe('DECLINED');
			expect(await briefOffers()).toBe(1); // the accepted one
			expect(onlyError(await sendOffer(rival.token))).toEqual({ code: 'BAD_REQUEST', message: Message.BRIEF_NOT_OPEN });

			expect((await setBriefStatus('OPEN')).errors).toBeUndefined();
			const again = await sendOffer(rival.token);
			expect(again.data?.createOffer).toMatchObject({ _id: rivalOfferId, offerStatus: 'PENDING' });
			expect(await briefOffers()).toBe(2);
		});

		it('a PENDING offer past its expiry reads as EXPIRED before the job runs, and cannot be accepted', async () => {
			await connection
				.collection('offers')
				.updateOne({ _id: new Types.ObjectId(rivalOfferId) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

			expect((await getOffer(rivalOfferId, owner.token)).data?.getOffer).toMatchObject({
				offerStatus: 'EXPIRED',
				expiresAt: null,
			});
			expect(onlyError(await moveOffer('acceptOffer', rivalOfferId, owner.token))).toEqual({
				code: 'BAD_REQUEST',
				message: Message.OFFER_EXPIRED,
			});

			// sending it again: it was still counted, so briefOffers doesn't move
			expect((await sendOffer(rival.token)).data?.createOffer.offerStatus).toBe('PENDING');
			expect(await briefOffers()).toBe(2);
		});

		it('the owner declines: briefOffers 1; a declined offer cannot be sent again', async () => {
			expect((await moveOffer('declineOffer', rivalOfferId, owner.token)).data?.declineOffer.offerStatus).toBe(
				'DECLINED',
			);
			expect(await briefOffers()).toBe(1);
			expect(onlyError(await sendOffer(rival.token))).toEqual({
				code: 'BAD_REQUEST',
				message: Message.INVALID_OFFER_STATUS_CHANGE,
			});
		});
	});
	// own members, brief and offer, like the offers block
	describe('1:1 chat on an offer (D-49)', () => {
		const owner = { _id: '', token: '' };
		const maker = { _id: '', token: '' };
		const stranger = { _id: '', token: '' };
		let offerId = '';
		let conversationId = '';
		const uuid = (n: number) => `0b6e9c2e-8a9d-4f1b-9a8e-${String(n).padStart(12, '0')}`;

		type ConversationView = { _id: string; canWrite: boolean; readOnlyReason: string | null; meUnread: number | null };
		const CONVERSATION = '_id canWrite readOnlyReason meUnread lastMessagePreview';

		const open = (token: string) =>
			gql<{ openConversation: ConversationView }>(
				app,
				`mutation ($id: String!) { openConversation(offerId: $id) { ${CONVERSATION} } }`,
				{ id: offerId },
				token,
			);
		const getConversation = (token: string) =>
			gql<{ getConversation: ConversationView }>(
				app,
				`query ($id: String!) { getConversation(conversationId: $id) { ${CONVERSATION} } }`,
				{ id: conversationId },
				token,
			);
		const send = (token: string, messageText: string, clientMessageId: string) =>
			gql<{ sendMessage: { _id: string; messageText: string } }>(
				app,
				`mutation ($input: SendMessageInput!) { sendMessage(input: $input) { _id messageText } }`,
				{ input: { conversationId, messageText, clientMessageId } },
				token,
			);
		const unread = async (token: string) =>
			(await gql<{ getChatUnreadCount: number }>(app, `query { getChatUnreadCount }`, {}, token)).data!
				.getChatUnreadCount;
		const history = (token: string, extra: Record<string, unknown> = {}) =>
			gql<{ getMessages: { list: Array<{ _id: string; messageText: string }>; hasMore: boolean } }>(
				app,
				`query ($input: MessagesInquiry!) { getMessages(input: $input) { list { _id messageText } hasMore } }`,
				{ input: { conversationId, limit: 1, ...extra } },
				token,
			);
		const waitPastRateLimit = () => new Promise((resolve) => setTimeout(resolve, 1100));

		beforeAll(async () => {
			for (const [member, nick, type, phone] of [
				[owner, 'e2e_chat_owner', 'USER', '+998900000041'],
				[maker, 'e2e_chat_maker', 'CREATOR', '+998900000042'],
				[stranger, 'e2e_chat_other', 'CREATOR', '+998900000043'],
			] as const) {
				const response = await signup(nick, type, phone);
				member._id = response.data!.signup._id;
				member.token = response.data!.signup.accessToken;
			}
			const brief = await gql<{ createBrief: { _id: string } }>(
				app,
				`mutation ($input: BriefInput!) { createBrief(input: $input) { _id } }`,
				{
					input: {
						briefCategory: 'CUSTOMER_SUPPORT',
						briefTitle: 'E2E chat brief',
						briefContent: 'A support bot for a flower shop, in Uzbek.',
					},
				},
				owner.token,
			);
			const offer = await gql<{ createOffer: { _id: string } }>(
				app,
				`mutation ($input: OfferInput!) { createOffer(input: $input) { _id } }`,
				{
					input: {
						briefId: brief.data!.createBrief._id,
						offerPrice: 200,
						offerDeliveryDays: 5,
						offerMessage: 'I have built a bot like this for a florist.',
					},
				},
				maker.token,
			);
			offerId = offer.data!.createOffer._id;
		});

		it('only the brief owner opens it; opening again returns the same conversation', async () => {
			expect(onlyError(await open(maker.token)).code).toBe('FORBIDDEN');

			const first = await open(owner.token);
			expect(first.errors).toBeUndefined();
			conversationId = first.data!.openConversation._id;
			expect(first.data!.openConversation).toMatchObject({ canWrite: true, readOnlyReason: null, meUnread: 0 });
			expect((await open(owner.token)).data?.openConversation._id).toBe(conversationId);
			expect(await connection.collection('conversations').countDocuments({})).toBe(1);
		});

		it('only its two members read it', async () => {
			expect((await getConversation(maker.token)).errors).toBeUndefined();
			expect(onlyError(await getConversation(stranger.token)).message).toBe(Message.NO_DATA_FOUND);
		});

		it('a message is stored trimmed, once per clientMessageId, and counted unread for the other side', async () => {
			const first = await send(owner.token, '  When can you start?  ', uuid(1));
			const retry = await send(owner.token, '  When can you start?  ', uuid(1));

			expect(first.data?.sendMessage.messageText).toBe('When can you start?');
			expect(retry.data?.sendMessage._id).toBe(first.data?.sendMessage._id);
			expect(await connection.collection('messages').countDocuments({})).toBe(1);
			expect(await unread(maker.token)).toBe(1);
			expect(await unread(owner.token)).toBe(0);
		});

		it('a second message within a second → CHAT_RATE_LIMITED', async () => {
			expect(onlyError(await send(owner.token, 'Also, which CRM?', uuid(2)))).toEqual({
				code: 'BAD_REQUEST',
				message: Message.CHAT_RATE_LIMITED,
			});
		});

		it('reading zeroes the reader’s count; the other side answers', async () => {
			const read = await gql<{ markConversationRead: ConversationView }>(
				app,
				`mutation ($id: String!) { markConversationRead(conversationId: $id) { meUnread } }`,
				{ id: conversationId },
				maker.token,
			);
			expect(read.data?.markConversationRead.meUnread).toBe(0);

			expect((await send(maker.token, 'Monday works.', uuid(3))).errors).toBeUndefined();
			expect(await unread(owner.token)).toBe(1);
		});

		it('history pages by cursor, oldest first', async () => {
			const latest = (await history(owner.token)).data!.getMessages;
			expect(latest.list.map((message) => message.messageText)).toEqual(['Monday works.']);
			expect(latest.hasMore).toBe(true);

			const older = (await history(owner.token, { before: latest.list[0]._id })).data!.getMessages;
			expect(older.list.map((message) => message.messageText)).toEqual(['When can you start?']);
			expect(older.hasMore).toBe(false);
		});

		it('declining the offer makes the conversation read-only', async () => {
			await gql(app, `mutation ($id: String!) { declineOffer(offerId: $id) { _id } }`, { id: offerId }, owner.token);
			expect((await getConversation(owner.token)).data?.getConversation).toMatchObject({
				canWrite: false,
				readOnlyReason: 'OFFER_CLOSED',
			});

			await waitPastRateLimit();
			expect(onlyError(await send(owner.token, 'One more thing', uuid(4)))).toEqual({
				code: 'BAD_REQUEST',
				message: Message.CONVERSATION_READ_ONLY,
			});
		});

		it('an admin lists conversations without their messages, filters by lock and locks one', async () => {
			// admins are created by script only (D-14): promote a member in the DB, then log in for an ADMIN token
			await signup('e2e_chat_admin', 'USER', '+998900000044');
			await connection
				.collection('members')
				.updateOne({ memberNick: 'e2e_chat_admin' }, { $set: { memberType: 'ADMIN' } });
			const adminToken = (await login('e2e_chat_admin')).data!.login.accessToken;

			type AdminRow = {
				_id: string;
				lastMessagePreview: string | null;
				lastMessageAt: string | null;
				lockedByAdmin: boolean;
			};
			const adminList = async (lockedByAdmin?: boolean) =>
				(
					await gql<{ getConversationsByAdmin: { list: AdminRow[] } }>(
						app,
						`query ($input: ConversationsAdminInquiry!) { getConversationsByAdmin(input: $input) {
							list { _id lastMessagePreview lastMessageAt lockedByAdmin } } }`,
						{ input: { page: 1, limit: 20, ...(lockedByAdmin !== undefined && { lockedByAdmin }) } },
						adminToken,
					)
				).data!.getConversationsByAdmin.list;
			const lock = (locked: boolean) =>
				gql(
					app,
					`mutation ($id: String!, $locked: Boolean!) { lockConversationByAdmin(conversationId: $id, locked: $locked) { _id lockedByAdmin } }`,
					{ id: conversationId, locked },
					adminToken,
				);

			const [row] = await adminList();
			expect(row).toMatchObject({ _id: conversationId, lastMessagePreview: null, lockedByAdmin: false });
			expect(row.lastMessageAt).not.toBeNull();
			expect((await lock(true)).errors).toBeUndefined();

			expect((await adminList(true)).map((item) => item._id)).toEqual([conversationId]);
			expect(await adminList(false)).toEqual([]);
			expect((await getConversation(owner.token)).data?.getConversation.readOnlyReason).toBe('LOCKED_BY_ADMIN');

			await lock(false);
			expect((await getConversation(owner.token)).data?.getConversation.readOnlyReason).toBe('OFFER_CLOSED');
			// a member can't lock
			expect(
				onlyError(
					await gql(
						app,
						`mutation ($id: String!) { lockConversationByAdmin(conversationId: $id, locked: true) { _id } }`,
						{ id: conversationId },
						owner.token,
					),
				).code,
			).toBe('FORBIDDEN');
		});
	});

	describe('notifications (D-50)', () => {
		const owner = { _id: '', token: '' };
		const maker = { _id: '', token: '' };
		let briefId = '';
		let offerId = '';

		type NotificationView = {
			_id: string;
			notificationType: string;
			notificationStatus: string;
			notificationTitle: string;
			notificationDesc: string | null;
			briefId: string | null;
			authorData: { memberNick: string } | null;
		};
		const list = async (token: string, unreadOnly = false) =>
			(
				await gql<{ getMyNotifications: { list: NotificationView[]; metaCounter: Array<{ total: number }> } }>(
					app,
					`query ($input: NotificationsInquiry!) { getMyNotifications(input: $input) {
						list { _id notificationType notificationStatus notificationTitle notificationDesc briefId authorData { memberNick } }
						metaCounter { total } } }`,
					{ input: { page: 1, limit: 20, unreadOnly } },
					token,
				)
			).data!.getMyNotifications;
		const unread = async (token: string) =>
			(await gql<{ getNotificationUnreadCount: number }>(app, `query { getNotificationUnreadCount }`, {}, token)).data!
				.getNotificationUnreadCount;

		beforeAll(async () => {
			for (const [member, nick, type, phone] of [
				[owner, 'e2e_notif_owner', 'USER', '+998900000051'],
				[maker, 'e2e_notif_maker', 'CREATOR', '+998900000052'],
			] as const) {
				const response = await signup(nick, type, phone);
				member._id = response.data!.signup._id;
				member.token = response.data!.signup.accessToken;
			}
			const brief = await gql<{ createBrief: { _id: string } }>(
				app,
				`mutation ($input: BriefInput!) { createBrief(input: $input) { _id } }`,
				{
					input: {
						briefCategory: 'CUSTOMER_SUPPORT',
						briefTitle: 'E2E notification brief',
						briefContent: 'A booking bot for a dental clinic.',
					},
				},
				owner.token,
			);
			briefId = brief.data!.createBrief._id;
		});

		it('an invite reaches the creator once, however often the owner invites', async () => {
			for (let i = 0; i < 2; i++) {
				await gql(
					app,
					`mutation ($briefId: String!, $creatorId: String!) { inviteCreator(briefId: $briefId, creatorId: $creatorId) { _id } }`,
					{ briefId, creatorId: maker._id },
					owner.token,
				);
			}
			const { list: received } = await list(maker.token);
			expect(received.map((n) => n.notificationType)).toEqual(['INVITE']);
			expect(received[0]).toMatchObject({
				notificationTitle: 'E2E notification brief',
				briefId,
				notificationStatus: 'WAIT',
				authorData: { memberNick: 'e2e_notif_owner' },
			});
		});

		it('an offer reaches the owner; accepting it reaches the creator', async () => {
			const offer = await gql<{ createOffer: { _id: string } }>(
				app,
				`mutation ($input: OfferInput!) { createOffer(input: $input) { _id } }`,
				{ input: { briefId, offerPrice: 150, offerDeliveryDays: 4, offerMessage: 'I built one for a clinic.' } },
				maker.token,
			);
			offerId = offer.data!.createOffer._id;
			expect((await list(owner.token)).list.map((n) => n.notificationType)).toEqual(['OFFER_RECEIVED']);

			await gql(app, `mutation ($id: String!) { acceptOffer(offerId: $id) { _id } }`, { id: offerId }, owner.token);
			expect((await list(maker.token)).list.map((n) => n.notificationType)).toEqual(['OFFER_ACCEPTED', 'INVITE']);
		});

		it('a comment on the brief reaches its owner with the start of the text; their own comment does not', async () => {
			const comment = (token: string, commentContent: string) =>
				gql(
					app,
					`mutation ($input: CommentInput!) { createComment(input: $input) { _id } }`,
					{ input: { commentGroup: 'BRIEF', commentRefId: briefId, commentContent } },
					token,
				);
			await comment(maker.token, 'Do you need Russian too?');
			await comment(owner.token, 'Uzbek and Russian, yes.');

			const { list: received } = await list(owner.token);
			expect(received.map((n) => n.notificationType)).toEqual(['COMMENT', 'OFFER_RECEIVED']);
			expect(received[0].notificationDesc).toBe('Do you need Russian too?');
		});

		it('a follow reaches the member once, even after unfollowing and following again', async () => {
			for (const mutation of ['subscribe', 'unsubscribe', 'subscribe']) {
				await gql(app, `mutation ($id: String!) { ${mutation}(input: $id) { _id } }`, { id: maker._id }, owner.token);
			}
			const follows = (await list(maker.token)).list.filter((n) => n.notificationType === 'FOLLOW');
			expect(follows).toHaveLength(1);
		});

		it('reading one and then all; nobody else can read them', async () => {
			expect(await unread(maker.token)).toBe(3);
			const [latest] = (await list(maker.token)).list;

			const foreign = await gql(
				app,
				`mutation ($id: String!) { markNotificationRead(notificationId: $id) { _id } }`,
				{ id: latest._id },
				owner.token,
			);
			expect(onlyError(foreign).message).toBe(Message.NO_DATA_FOUND);

			await gql(
				app,
				`mutation ($id: String!) { markNotificationRead(notificationId: $id) { _id } }`,
				{ id: latest._id },
				maker.token,
			);
			expect(await unread(maker.token)).toBe(2);
			expect((await list(maker.token, true)).list).toHaveLength(2);

			const all = await gql<{ markAllNotificationsRead: number }>(
				app,
				`mutation { markAllNotificationsRead }`,
				{},
				maker.token,
			);
			expect(all.data?.markAllNotificationsRead).toBe(2);
			expect(await unread(maker.token)).toBe(0);
		});
	});

	describe('hardening (D-51)', () => {
		it('a list page takes at most 100 items, in whole numbers', async () => {
			const briefs = (limit: number) =>
				gql(app, `query ($limit: Int!) { getBriefs(input: { page: 1, limit: $limit, search: {} }) { list { _id } } }`, {
					limit,
				});
			expect((await briefs(100)).errors).toBeUndefined();
			expect(onlyError(await briefs(101)).code).toBe('BAD_REQUEST');
		});

		it('an operation nested deeper than 8 fields is refused before it runs (Brief.meOffer ↔ Offer.briefData)', async () => {
			const nested = (levels: number) => {
				let selection = '_id';
				for (let i = 0; i < levels; i++) selection = i % 2 ? `briefData { ${selection} }` : `meOffer { ${selection} }`;
				return `query { getBrief(briefId: "6ac7992dd87bde19b9216d01") { ${selection} } }`;
			};
			// getBrief + 6 nested + _id = 8 levels: runs (and finds no such brief)
			expect(onlyError(await gql(app, nested(6))).code).toBe('NOT_FOUND');
			// one more level: refused by validation, nothing runs
			expect(onlyError(await gql(app, nested(7)))).toEqual({
				code: 'GRAPHQL_VALIDATION_FAILED',
				message: 'Query is too deep: at most 8 levels are allowed!',
			});
		});

		it('10 wrong passwords from one address lock that nick there for a while: TOO_MANY_REQUESTS', async () => {
			const wrongLogin = () =>
				gql(app, `mutation ($input: LoginInput!) { login(input: $input) { _id } }`, {
					input: { memberNick: 'e2e_guess', memberPassword: 'wrong-password' },
				});
			for (let i = 0; i < 10; i++) expect(onlyError(await wrongLogin()).code).toBe('UNAUTHENTICATED');
			expect(onlyError(await wrongLogin())).toEqual({
				code: 'TOO_MANY_REQUESTS',
				message: Message.TOO_MANY_LOGIN_ATTEMPTS,
			});
		});
	});

	describe('semantic search (D-52)', () => {
		it('without a provider, a text search with sort "relevance" still answers (no match → empty list)', async () => {
			const products = await gql<{ getProducts: { list: unknown[] } }>(
				app,
				`query { getProducts(input: { page: 1, limit: 5, sort: "relevance", search: { text: "zzz-no-such-title" } }) {
					list { _id } } }`,
			);
			expect(products.errors).toBeUndefined();
			expect(products.data?.getProducts.list).toEqual([]);

			const briefs = await gql<{ getBriefs: { list: unknown[] } }>(
				app,
				`query { getBriefs(input: { page: 1, limit: 5, sort: "relevance", search: { text: "zzz-no-such-title" } }) {
					list { _id } } }`,
			);
			expect(briefs.errors).toBeUndefined();
		});

		it('without a provider a product is stored PENDING and gets no vector (the reconcile job embeds it later)', async () => {
			const stored = await connection.collection('products').findOne({}, { sort: { _id: -1 } });
			expect(stored?.embeddingStatus).toBe('PENDING');
			expect(stored).not.toHaveProperty('embedding');
		});
	});

	describe('hybrid search: the keyword half (D-53)', () => {
		const ids = <K extends string>(response: { data?: Record<K, { list: Array<{ _id: string }> }> | null }, key: K) =>
			(response.data?.[key].list ?? []).map((item) => item._id);

		beforeAll(async () => {
			// Mongoose builds the schema indexes in the background at startup; wait for the text indexes.
			await Promise.all([connection.models.Product.init(), connection.models.Brief.init()]);
		});

		it('finds a product by a word of its description (title matching alone missed it), stemmed', async () => {
			const { insertedId } = await connection.collection('products').insertOne({
				productCategory: 'DATA_ANALYSIS',
				productStatus: 'ACTIVE',
				productPricing: 'FREE',
				productTitle: 'E2E books helper',
				productImages: ['uploads/product/e2e.png'],
				productDesc: 'Reconciles quarterly ledgers and flags odd invoices.',
				productTags: [],
				memberId: new Types.ObjectId(creator._id),
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			const response = await gql<{ getProducts: { list: Array<{ _id: string }> } }>(
				app,
				`query { getProducts(input: { page: 1, limit: 5, search: { text: "ledger" } }) { list { _id } } }`,
			);
			expect(response.errors).toBeUndefined();
			expect(ids(response, 'getProducts')).toEqual([String(insertedId)]);
		});

		it('finds a brief by a word of its content, best match first', async () => {
			const base = { briefCategory: 'OTHER', briefStatus: 'OPEN', memberId: new Types.ObjectId(user._id) };
			const now = Date.now();
			const { insertedIds } = await connection.collection('briefs').insertMany([
				// newer, but the word is only in the content once
				{
					...base,
					briefTitle: 'E2E shop helper',
					briefContent: 'A bot for our greenhouse orders.',
					createdAt: new Date(now),
				},
				// older, the word in the title weighs more
				{
					...base,
					briefTitle: 'E2E greenhouse bot',
					briefContent: 'Answers questions.',
					createdAt: new Date(now - 60_000),
				},
			]);

			const response = await gql<{ getBriefs: { list: Array<{ _id: string }> } }>(
				app,
				`query { getBriefs(input: { page: 1, limit: 5, search: { text: "greenhouses" } }) { list { _id } } }`,
			);
			expect(response.errors).toBeUndefined();
			expect(ids(response, 'getBriefs')).toEqual([String(insertedIds[1]), String(insertedIds[0])]);
		});
	});
});
