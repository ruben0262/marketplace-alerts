import { token } from './security.js';

export const SUPPORT_EMAIL = 'hello@flow-solutions.xyz';

// Durable, leased delivery keeps support mail independent of slow marketplace scans.
export async function deliverSupportTicket(db, sendEmail, logger) {
  if (!sendEmail) return false;
  const tickets = db.collection('supportTickets'), now = new Date(), lockToken = token();
  const ticket = await tickets.findOneAndUpdate({ state: 'pending', retryAt: { $lte: now }, $or: [{ lockUntil: { $exists: false } }, { lockUntil: { $lte: now } }] },
    { $set: { lockToken, lockUntil: new Date(Date.now() + 60000) } }, { sort: { retryAt: 1 }, returnDocument: 'after' });
  if (!ticket) return false;
  const lock = { _id: ticket._id, lockToken };
  try {
    await sendEmail({ to: ticket.to, replyTo: ticket.email, subject: `[Scout ${ticket.reference}] ${ticket.subject}`,
      messageId: `<support-${ticket._id}@scout.rubenlekli.com>`,
      text: [`Support request ${ticket.reference}`, `Reply to: ${ticket.email}`, '', ticket.message].join('\n') });
    await tickets.updateOne(lock, { $set: { state: 'sent', sentAt: new Date() } });
    logger?.info('support.sent');
  } catch (error) {
    const attempts = ticket.attempts + 1;
    await tickets.updateOne(lock, { $set: { attempts, retryAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(attempts, 7))) } });
    logger?.warn('support.delivery_failed', { attempt: attempts, errorName: error.name });
  } finally { await tickets.updateOne(lock, { $unset: { lockToken: '', lockUntil: '' } }); }
  return true;
}
