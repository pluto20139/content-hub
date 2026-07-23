import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

let refreshPromise: Promise<{ data: { session: unknown } }> | null = null;

async function getSessionOrRefresh() {
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = supabase.auth.refreshSession().catch(() => ({ data: { session: null } })).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    fetch: async (input, init) => {
      const res = await fetch(input, init);
      const urlStr = typeof input === "string" ? input : (input && typeof input === "object" && "url" in input ? String((input as { url: unknown }).url) : "");
      if (res.status === 401 && !urlStr.includes("/auth/v1/")) {
        const refreshResult = await getSessionOrRefresh();
        if (refreshResult?.data?.session) {
          const token = (refreshResult.data.session as { access_token: string }).access_token;
          const newInit: RequestInit = { ...init };
          const headers = new Headers(newInit.headers);
          headers.set("Authorization", `Bearer ${token}`);
          newInit.headers = headers;
          return fetch(input, newInit);
        } else {
          window.location.hash = "#/login";
        }
      }
      return res;
    },
  },
});
