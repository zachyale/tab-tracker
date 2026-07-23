import nodemailer from "nodemailer";
import { env, smtpEnabled } from "./env.js";

const transport = smtpEnabled
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null;

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!transport) {
    console.warn(`[mailer] SMTP not configured; dropping mail to ${to}: ${subject}`);
    return;
  }
  await transport.sendMail({ from: env.smtp.from, to, subject, text });
}
