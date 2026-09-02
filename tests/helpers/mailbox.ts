/**
 * Emails the application tried to send during a test.
 *
 * SMTP is a system boundary the tests do not own, so server/utils/mailer.ts is
 * substituted (tests/setup.ts) with a collector. This is also the only way to
 * observe the verification and password-reset tokens the way a real user does
 * - by reading them out of the link they were emailed.
 */
export type SentMail = { to: string; subject: string; html: string };

export const mailbox: SentMail[] = [];

export function clearMailbox() {
  mailbox.length = 0;
}

export function lastMailTo(address: string): SentMail | undefined {
  return [...mailbox].reverse().find((mail) => mail.to.toLowerCase() === address.toLowerCase());
}

/** Pulls the `?token=...` value out of the first link in an email body. */
export function tokenFromMail(mail: SentMail | undefined): string | undefined {
  return mail?.html.match(/[?&]token=([A-Za-z0-9]+)/)?.[1];
}
