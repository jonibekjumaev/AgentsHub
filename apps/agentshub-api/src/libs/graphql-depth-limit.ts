import { GraphQLError, Kind } from 'graphql';
import type { ASTVisitor, FragmentDefinitionNode, SelectionSetNode, ValidationContext } from 'graphql';

/**
 * D-51: a validation rule that refuses operations nested deeper than `maxDepth` fields, before anything runs. The schema
 * has cycles (Offer.briefData → Brief.meOffer → Offer …, each level resolved with its own reads), so without it one
 * request could ask for an arbitrarily deep, arbitrarily expensive tree.
 * Fragments count where they are spread; introspection fields (`__schema`, `__type`, …) don't count, so tools that read
 * the schema keep working.
 */
export const depthLimit =
	(maxDepth: number) =>
	(context: ValidationContext): ASTVisitor => {
		const fragments = new Map<string, FragmentDefinitionNode>();
		for (const definition of context.getDocument().definitions) {
			if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
		}

		const depthOf = (selectionSet: SelectionSetNode | undefined, seen: Set<string>): number => {
			if (!selectionSet) return 0;
			let deepest = 0;
			for (const selection of selectionSet.selections) {
				if (selection.kind === Kind.FIELD) {
					if (selection.name.value.startsWith('__')) continue;
					deepest = Math.max(deepest, 1 + depthOf(selection.selectionSet, seen));
				} else if (selection.kind === Kind.INLINE_FRAGMENT) {
					deepest = Math.max(deepest, depthOf(selection.selectionSet, seen));
				} else {
					const name = selection.name.value;
					const fragment = fragments.get(name);
					// an unknown or cyclic spread is reported by graphql's own rules
					if (!fragment || seen.has(name)) continue;
					deepest = Math.max(deepest, depthOf(fragment.selectionSet, new Set(seen).add(name)));
				}
				if (deepest > maxDepth) return deepest; // already too deep: no need to walk the rest
			}
			return deepest;
		};

		return {
			OperationDefinition(operation) {
				const depth = depthOf(operation.selectionSet, new Set());
				if (depth > maxDepth) {
					context.reportError(
						new GraphQLError(`Query is too deep: at most ${maxDepth} levels are allowed!`, { nodes: [operation] }),
					);
				}
			},
		};
	};
