import type { AuthError, Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const RECOVERABLE_AUTH_MESSAGES = [
  "invalid refresh token",
  "refresh token not found",
  "refresh_token_not_found",
  "jwt expired",
  "session_not_found",
  "auth session missing",
  "session missing",
];

function clearStoredAuthTokens() {
  if (typeof window === "undefined") return;
  Object.keys(window.localStorage).forEach((key) => {
    if (/^sb-.*-auth-token$/i.test(key) || key === "supabase.auth.token") {
      window.localStorage.removeItem(key);
    }
  });
}

function isRecoverableAuthError(error: AuthError | Error | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  const name = (error as { name?: string } | null | undefined)?.name?.toLowerCase() ?? "";
  return name.includes("authsessionmissing") || RECOVERABLE_AUTH_MESSAGES.some((item) => message.includes(item));
}

export async function clearLocalAuthState() {
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  clearStoredAuthTokens();
}

export async function getAuthenticatedUser(): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (isRecoverableAuthError(error)) {
    await clearLocalAuthState();
    return null;
  }
  if (error) throw error;
  return data.user ?? null;
}

export async function getLocalSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session;
}

export async function replaceAuthSession(session: Pick<Session, "access_token" | "refresh_token">) {
  clearStoredAuthTokens();
  const { data, error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw error;
  return data.session;
}
