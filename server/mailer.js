import nodemailer from 'nodemailer';

export function createMailer(env = process.env) {
  if (!env.SMTP_HOST || !env.MAIL_FROM) return null;
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true',
    requireTLS: env.SMTP_SECURE !== 'true', disableFileAccess: true, disableUrlAccess: true,
    ...(env.SMTP_USER && { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD || '' } }),
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  });
  const send = message => transporter.sendMail({ ...message, from: env.MAIL_FROM });
  send.verify = () => transporter.verify();
  return send;
}

export function productEmail(match, recipient) {
  const price = match.price === null ? 'Price not supplied' : `${match.price} ${match.currency || ''}`;
  return {
    to: recipient, subject: `Scout found a match: ${match.title}`.replace(/[\r\n]/g, ' ').slice(0, 200),
    text: [`New match for ${match.searchName}`, '', match.title, price, `Marketplace: ${match.source}`, '', /^https:\/\//.test(match.url) ? match.url : '', '', 'Manage this search and its alert destinations in Scout.'].join('\n'),
  };
}
