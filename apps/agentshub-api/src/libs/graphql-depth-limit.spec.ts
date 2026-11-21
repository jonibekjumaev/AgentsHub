import { buildSchema, getIntrospectionQuery, parse, validate } from 'graphql';
import { depthLimit } from './graphql-depth-limit';

// a schema with a cycle, like Member → products → member
const schema = buildSchema(`
	type Member { _id: String nick: String products: [Product] }
	type Product { _id: String member: Member }
	type Query { member: Member }
`);
const errorsOf = (query: string, max = 3) => validate(schema, parse(query), [depthLimit(max)]).map((e) => e.message);

describe('depthLimit (D-51)', () => {
	it('lets operations up to the limit through and refuses deeper ones', () => {
		expect(errorsOf('{ member { products { member { nick } } } }', 4)).toEqual([]);
		expect(errorsOf('{ member { products { member { products { _id } } } } }', 4)).toEqual([
			'Query is too deep: at most 4 levels are allowed!',
		]);
	});

	it('counts fragments where they are spread, inline ones too', () => {
		const query = `
			query { member { ...M } }
			fragment M on Member { products { ... on Product { member { products { _id } } } } }
		`;
		expect(errorsOf(query, 4)).toHaveLength(1);
		expect(errorsOf(query, 5)).toEqual([]);
	});

	it('does not count introspection, so schema tools keep working', () => {
		expect(validate(schema, parse(getIntrospectionQuery()), [depthLimit(3)])).toEqual([]);
	});

	it('survives a fragment that spreads itself (graphql reports that one itself)', () => {
		expect(() => errorsOf('{ member { ...M } } fragment M on Member { products { member { ...M } } }')).not.toThrow();
	});
});
