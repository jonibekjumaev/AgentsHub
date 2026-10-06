// Step 6 part 11: delete the dev test products and their dependents (dev DB `agentsHub`). Re-runnable.
// Part 11 makes productCategory, productPricing and productDesc required (non-null in GraphQL). Old products lack them,
// and one such product breaks every product read and list. They are Nestar/test data (D-13); the seed script replaces them.
// Back up first, stop the API and batch, then run with mongosh (or paste into the Compass mongosh tab).
// Not touched: uploaded images in uploads/product/ and uploads/property/ (local, gitignored).
const d = db.getSiblingDB('agentsHub');

const dependents = {
	likes: { likeGroup: 'PRODUCT' },
	views: { viewGroup: 'PRODUCT' },
	comments: { commentGroup: 'PRODUCT' },
	notifications: { notificationGroup: 'PRODUCT' },
};

const counts = () => {
	const result = { products: d.products.countDocuments({}) };
	for (const [name, filter] of Object.entries(dependents)) result[name] = d[name].countDocuments(filter);
	result.membersWithMemberProducts = d.members.countDocuments({ memberProducts: { $ne: 0 } });
	return result;
};

print('before:');
printjson(counts());

printjson({ products: d.products.deleteMany({}) });
for (const [name, filter] of Object.entries(dependents)) printjson({ [name]: d[name].deleteMany(filter) });
// no products are left, so every creator's counter is 0
printjson({ members: d.members.updateMany({ memberProducts: { $ne: 0 } }, { $set: { memberProducts: 0 } }) });

// checks: every count must be 0
print('after:');
printjson(counts());
