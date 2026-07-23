import { createAuthClient } from "better-auth/react";
import { adminClient, genericOAuthClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [genericOAuthClient(), adminClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
