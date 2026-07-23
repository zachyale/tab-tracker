import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import { count } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { env, googleEnabled, oidcEnabled, smtpEnabled } from "./env.js";
import { sendMail } from "./mailer.js";

async function isFirstUser(): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(schema.user);
  return (row?.n ?? 0) === 0;
}

export const auth = betterAuth({
  baseURL: env.baseUrl,
  secret: env.authSecret || "dev-only-insecure-secret-change-me",
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "user", input: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (u) => {
          // The first user to register becomes the instance admin.
          const first = await isFirstUser();
          return { data: { ...u, role: first ? "admin" : "user" } };
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    // Only enforce verification when the instance can actually send email.
    requireEmailVerification: smtpEnabled,
    sendResetPassword: async ({ user, url }) => {
      await sendMail(
        user.email,
        `Reset your ${env.instanceName} password`,
        `Click the link to reset your password: ${url}`
      );
    },
  },
  emailVerification: {
    sendOnSignUp: smtpEnabled,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail(
        user.email,
        `Verify your email for ${env.instanceName}`,
        `Click the link to verify your email: ${url}`
      );
    },
  },
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: env.google.clientId,
          clientSecret: env.google.clientSecret,
        },
      }
    : {},
  plugins: oidcEnabled
    ? [
        genericOAuth({
          config: [
            {
              providerId: "oidc",
              discoveryUrl: env.oidc.discoveryUrl,
              clientId: env.oidc.clientId,
              clientSecret: env.oidc.clientSecret,
              scopes: ["openid", "profile", "email"],
            },
          ],
        }),
      ]
    : [],
});

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  const u = session.user as SessionUser & Record<string, unknown>;
  return { id: u.id, name: u.name, email: u.email, role: u.role ?? "user" };
}
