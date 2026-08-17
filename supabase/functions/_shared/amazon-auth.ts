// supabase/functions/_shared/amazon-auth.ts
// Amazon LWA (Login with Amazon) token exchange
// Fetches credentials from Deno.env secrets or system_settings database table

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface LwaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getSetting(key: string, db?: ReturnType<typeof createClient>): Promise<string | null> {
  const envVal = Deno.env.get(key);
  if (envVal) return envVal;

  if (!db) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceKey) {
      db = createClient(supabaseUrl, serviceKey);
    }
  }

  if (db) {
    const { data } = await db.from("system_settings").select("value").eq("key", key.toLowerCase()).single();
    if (data?.value) return data.value;
  }

  return null;
}

export async function getAmazonAccessToken(db?: ReturnType<typeof createClient>): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at - 60_000) {
    return cachedToken.access_token;
  }

  const clientId = await getSetting("AMAZON_CLIENT_ID", db);
  const clientSecret = await getSetting("AMAZON_CLIENT_SECRET", db);
  const refreshToken = await getSetting("AMAZON_REFRESH_TOKEN", db);

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Amazon credentials. Set AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET, AMAZON_REFRESH_TOKEN in Supabase Secrets or Admin Settings UI."
    );
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Amazon LWA token exchange failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as LwaTokenResponse;

  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.access_token;
}

export async function getSpApiBaseUrl(db?: ReturnType<typeof createClient>): Promise<string> {
  const region = (await getSetting("AMAZON_REGION", db)) || "eu-west-1";
  if (region.startsWith("eu") || region.startsWith("ap")) {
    return "https://sellingpartnerapi-eu.amazon.com";
  }
  if (region.startsWith("us") || region.startsWith("na")) {
    return "https://sellingpartnerapi-na.amazon.com";
  }
  return "https://sellingpartnerapi-fe.amazon.com";
}

export async function getMarketplaceId(db?: ReturnType<typeof createClient>): Promise<string> {
  const mId = await getSetting("AMAZON_MARKETPLACE_ID", db);
  return mId || "A21TJRUUN4KGV";
}

export async function getSellerId(db?: ReturnType<typeof createClient>): Promise<string> {
  const id = await getSetting("AMAZON_SELLER_ID", db);
  if (!id) throw new Error("AMAZON_SELLER_ID is not configured in secrets or settings");
  return id;
}

export async function spApiFetch(
  path: string,
  options: RequestInit = {},
  retries = 3,
  db?: ReturnType<typeof createClient>
): Promise<Response> {
  const baseUrl = await getSpApiBaseUrl(db);
  const accessToken = await getAmazonAccessToken(db);

  const headers = {
    "x-amz-access-token": accessToken,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(`${baseUrl}${path}`, { ...options, headers });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "5");
      await sleep(retryAfter * 1000);
      continue;
    }

    if (res.status === 503) {
      await sleep(2000 * (attempt + 1));
      continue;
    }

    return res;
  }

  throw new Error(`SP-API request failed after ${retries} retries: ${path}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
