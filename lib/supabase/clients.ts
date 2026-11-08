import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const ALLOWED_EMAIL = (process.env.ALLOWED_EMAIL || "sarkar1295sourav@gmail.com").toLowerCase();

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const publishable = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

/** Browser client. Uses the signed-in user's session; row-level security applies. */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

type CookieStore = {
  getAll(): { name: string; value: string }[];
  set?(name: string, value: string, options?: Record<string, unknown>): void;
};

/** Server client bound to the request cookies. */
export function serverClient(cookieStore: CookieStore) {
  return createServerClient(url(), publishable(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set?.(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only. Middleware refreshes them.
        }
      },
    },
  });
}

/** Admin client. Server-side only: bypasses row-level security. */
export function adminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url() || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY are not set");
  return createClient(url(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}
