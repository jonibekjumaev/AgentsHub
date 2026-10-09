import { INestApplication } from '@nestjs/common';
import { Connection } from 'mongoose';
import { Message } from '../src/libs/enums/common.enum';
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

		it('is a guest on public reads: contact fields are null', async () => {
			const product = await getProduct(productId, creator.token);

			expect(product.data?.getProduct.memberData).toMatchObject({ memberEmail: null, memberWhatsapp: null });
		});
	});
});
