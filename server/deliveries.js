export async function refreshDeliveryStates(db, matchIds) {
  if (!matchIds.length) return;
  const rows = await db.collection('deliveries').aggregate([
    { $match: { matchId: { $in: matchIds } } },
    { $group: { _id: '$matchId', states: { $addToSet: '$state' }, sentAt: { $max: '$sentAt' } } },
  ]).toArray();
  if (rows.length) await db.collection('matches').bulkWrite(rows.map(row => ({ updateOne: {
    filter: { _id: row._id }, update: { $set: { alertState: row.states.includes('pending') ? 'pending' : row.states.includes('sent') ? 'sent' : row.states.includes('seeded') ? 'seeded' : 'web-only', ...(row.sentAt && { sentAt: row.sentAt }) } },
  } })), { ordered: false });
}

export async function cancelDeliveries(db, filter) {
  const pending = { ...filter, state: 'pending' };
  const ids = await db.collection('deliveries').distinct('matchId', pending);
  await db.collection('deliveries').updateMany(pending, { $set: { state: 'cancelled' } });
  await refreshDeliveryStates(db, ids);
}
