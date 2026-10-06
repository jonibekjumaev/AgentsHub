// Step 6 part 8: members.memberProperties -> memberProducts (dev DB `agentsHub`). Re-runnable.
// Back up `members` first, stop the API and batch, then run with mongosh (or paste into the Compass mongosh tab).
// memberProducts was added in Step 5 (default 0) and nothing incremented it before this part,
// so memberProperties holds the real counts.
const d = db.getSiblingDB('agentsHub');

// $rename overwrites memberProducts; refuse if any member already has a non-zero value we would lose
const conflicts = d.members.countDocuments({
	memberProperties: { $exists: true },
	memberProducts: { $nin: [0, null] },
});
if (conflicts > 0) throw new Error(`${conflicts} members have both counters set: resolve by hand`);

printjson(
	d.members.updateMany({ memberProperties: { $exists: true } }, { $rename: { memberProperties: 'memberProducts' } }),
);

// check: must be 0
printjson({ membersWithMemberProperties: d.members.countDocuments({ memberProperties: { $exists: true } }) });

// informational: memberProducts vs. the actual non-DELETE products (D-16 counts ACTIVE + PAUSED); not fixed here
const actual = d.products
	.aggregate([{ $match: { productStatus: { $ne: 'DELETE' } } }, { $group: { _id: '$memberId', count: { $sum: 1 } } }])
	.toArray();
const byMember = Object.fromEntries(actual.map((a) => [a._id.toString(), a.count]));
const mismatches = d.members
	.find({}, { memberNick: 1, memberProducts: 1 })
	.toArray()
	.filter((m) => (m.memberProducts ?? 0) !== (byMember[m._id.toString()] ?? 0))
	.map((m) => ({
		memberNick: m.memberNick,
		memberProducts: m.memberProducts,
		actual: byMember[m._id.toString()] ?? 0,
	}));
printjson({ counterMismatches: mismatches });
