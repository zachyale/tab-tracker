import path from "node:path";
import fs from "node:fs";

function bool(v: string | undefined): boolean {
  return v === "1" || v?.toLowerCase() === "true";
}

const dataDir = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

export const env = {
  port: Number(process.env.PORT ?? 3000),
  baseUrl: process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
  dataDir,
  dbPath: path.join(dataDir, "tab-tracker.db"),
  authSecret: process.env.BETTER_AUTH_SECRET ?? "",
  instanceName: process.env.INSTANCE_NAME ?? "Tab Tracker",
  // Frontend build output; resolved relative to the server package in dev,
  // and set explicitly in the Docker image.
  webDist: process.env.WEB_DIST ?? path.resolve(process.cwd(), "../web/dist"),

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  },
  oidc: {
    name: process.env.OIDC_PROVIDER_NAME ?? "SSO",
    discoveryUrl: process.env.OIDC_DISCOVERY_URL ?? "",
    clientId: process.env.OIDC_CLIENT_ID ?? "",
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
  },
  // "oauth" leads with provider buttons on the login page; "password" leads
  // with the email/password form. Providers still show either way.
  defaultAuthMethod: process.env.DEFAULT_AUTH_METHOD === "oauth" ? "oauth" : "password",

  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: bool(process.env.SMTP_SECURE),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? "",
  },
};

export const googleEnabled = !!(env.google.clientId && env.google.clientSecret);
export const oidcEnabled = !!(env.oidc.discoveryUrl && env.oidc.clientId && env.oidc.clientSecret);
export const smtpEnabled = !!(env.smtp.host && env.smtp.from);

if (!env.authSecret) {
  console.warn(
    "[tab-tracker] BETTER_AUTH_SECRET is not set — using an insecure development secret. " +
      "Set it to a long random string in production."
  );
}
