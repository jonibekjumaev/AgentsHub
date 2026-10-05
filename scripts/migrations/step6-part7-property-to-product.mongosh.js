// Step 6 part 7: properties -> products (dev DB `agentsHub`). Re-runnable.
// Back up first, stop the API and batch, then run with mongosh (or paste into the Compass mongosh tab).
// Not migrated here: members.memberProperties (part 8) and productImages paths under uploads/property/ (part 10, D-13).
const d = db.getSiblingDB('agentsHub');
const names = d.getCollectionNames();

if (names.includes('properties')) {
	if (names.includes('products')) {
		// the API (Mongoose autoIndex) may already have created an empty `products`
		if (d.products.countDocuments() > 0)
			throw new Error('`properties` and a non-empty `products` both exist: resolve by hand');
		d.products.drop();
	}
	// keeps _id_; the old unique { memberId, propertyTitle } index would see every renamed doc as propertyTitle: null
	// and reject the $rename below with a duplicate key error
	d.properties.dropIndexes();
	d.properties.renameCollection('products');
	print('renamed properties -> products');
}

const fieldMap = {
	propertyStatus: 'productStatus',
	propertyTitle: 'productTitle',
	propertyPrice: 'productPrice',
	propertyViews: 'productViews',
	propertyLikes: 'productLikes',
	propertyComments: 'productComments',
	propertyRank: 'productRank',
	propertyImages: 'productImages',
	propertyDesc: 'productDesc',
};
printjson(d.products.updateMany({}, { $rename: fieldMap }));

// same indexes as schemas/Product.model.ts
d.products.createIndex({ memberId: 1, productTitle: 1 }, { unique: true });
d.products.createIndex({ memberId: 1, productStatus: 1 });
d.products.createIndex({ productStatus: 1, productRank: -1 });

printjson(d.likes.updateMany({ likeGroup: 'PROPERTY' }, { $set: { likeGroup: 'PRODUCT' } }));
printjson(d.views.updateMany({ viewGroup: 'PROPERTY' }, { $set: { viewGroup: 'PRODUCT' } }));
printjson(d.comments.updateMany({ commentGroup: 'PROPERTY' }, { $set: { commentGroup: 'PRODUCT' } }));
printjson(d.notifications.updateMany({ notificationGroup: 'PROPERTY' }, { $set: { notificationGroup: 'PRODUCT' } }));
printjson(d.notifications.updateMany({ propertyId: { $exists: true } }, { $rename: { propertyId: 'productId' } }));

// checks: every count must be 0
const leftoverKeys = {
	$expr: {
		$gt: [
			{
				$size: {
					$filter: {
						input: { $objectToArray: '$$ROOT' },
						cond: { $regexMatch: { input: '$$this.k', regex: /^property/ } },
					},
				},
			},
			0,
		],
	},
};
printjson({
	propertiesCollection: d.getCollectionNames().includes('properties') ? 1 : 0,
	productsWithPropertyKeys: d.products.countDocuments(leftoverKeys),
	likes: d.likes.countDocuments({ likeGroup: 'PROPERTY' }),
	views: d.views.countDocuments({ viewGroup: 'PROPERTY' }),
	comments: d.comments.countDocuments({ commentGroup: 'PROPERTY' }),
	notifications: d.notifications.countDocuments({
		$or: [{ notificationGroup: 'PROPERTY' }, { propertyId: { $exists: true } }],
	}),
});
printjson(d.products.getIndexes().map((i) => i.name));
