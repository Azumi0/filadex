/**
 * Characterisation tests for server/utils/mailer.ts.
 *
 * tests/setup.ts replaces this module for the rest of the suite, so these
 * tests reach for the real one with importActual. nodemailer is stubbed
 * instead - it is the boundary the mailer exists to talk to.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../helpers/db";
import { emailSettings } from "../../shared/schema";

const sendMailSpy = vi.fn(async () => ({ accepted: ["someone@example.com"] }));
const createTransport = vi.fn(() => ({ sendMail: sendMailSpy }));

vi.mock("nodemailer", () => ({ default: { createTransport } }));

/** The real mailer, not the collector tests/setup.ts installs. */
async function realMailer() {
  return await vi.importActual<typeof import("../../server/utils/mailer")>(
    "../../server/utils/mailer",
  );
}

const workingSettings = {
  id: 1,
  enabled: true,
  smtpHost: "smtp.example.com",
  smtpPort: 2525,
  smtpUser: "postmaster",
  smtpPassword: "hunter2",
  smtpSecure: false,
  fromEmail: "filadex@example.com",
  fromName: "Filadex",
};

type StoredSettings = typeof emailSettings.$inferInsert;

async function storeSettings(overrides: Partial<StoredSettings> = {}) {
  await db.insert(emailSettings).values({ ...workingSettings, ...overrides });
}

const message = { to: "someone@example.com", subject: "Hello", html: "<p>Hi</p>" };

beforeEach(() => {
  sendMailSpy.mockClear();
  createTransport.mockClear();
});

describe("getEmailSettings", () => {
  it("returns nothing when an installation has never configured SMTP", async () => {
    const { getEmailSettings } = await realMailer();

    expect(await getEmailSettings()).toBeUndefined();
  });

  it("returns the single stored settings row", async () => {
    await storeSettings();
    const { getEmailSettings } = await realMailer();

    const settings = await getEmailSettings();

    expect(settings).toMatchObject({ id: 1, enabled: true, smtpHost: "smtp.example.com" });
  });
});

describe("sendMail", () => {
  it("sends through the configured server and reports success", async () => {
    await storeSettings();
    const { sendMail } = await realMailer();

    const sent = await sendMail(message);

    expect(sent).toBe(true);
    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 2525,
      secure: false,
      auth: { user: "postmaster", pass: "hunter2" },
    });
    expect(sendMailSpy).toHaveBeenCalledWith({
      from: '"Filadex" <filadex@example.com>',
      to: "someone@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
    });
  });

  it("sends from the bare address when no display name is set", async () => {
    await storeSettings({ fromName: null });
    const { sendMail } = await realMailer();

    await sendMail(message);

    expect(sendMailSpy).toHaveBeenCalledWith(expect.objectContaining({ from: "filadex@example.com" }));
  });

  it("connects without credentials when no SMTP user is set", async () => {
    await storeSettings({ smtpUser: null });
    const { sendMail } = await realMailer();

    await sendMail(message);

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
  });

  it("falls back to port 587 when none is configured", async () => {
    await storeSettings({ smtpPort: null });
    const { sendMail } = await realMailer();

    await sendMail(message);

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587 }));
  });

  // A self-hosted install that never set up SMTP must not have its flows fail
  // just because an email could not go out, so these are quiet false returns
  // rather than thrown errors.
  it.each([
    ["SMTP was never configured", null],
    ["email is switched off", { enabled: false }],
    ["no SMTP host is set", { smtpHost: null }],
    ["no from address is set", { fromEmail: null }],
  ])("declines to send, without failing, when %s", async (_label, overrides) => {
    if (overrides !== null) {
      await storeSettings(overrides);
    }
    const { sendMail } = await realMailer();

    const sent = await sendMail(message);

    expect(sent).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("reports failure, without throwing, when the SMTP server rejects the message", async () => {
    await storeSettings();
    sendMailSpy.mockRejectedValueOnce(new Error("550 mailbox unavailable") as never);
    const { sendMail } = await realMailer();

    const sent = await sendMail(message);

    expect(sent).toBe(false);
  });
});
