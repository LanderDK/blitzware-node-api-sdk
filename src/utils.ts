import axios from "axios";
const DEFAULT_AUTH_BASE_URL = "https://auth.blitzware.xyz/api/auth/";

export function normalizeAuthBaseUrl(authBaseUrl?: string): string {
  const value = authBaseUrl || DEFAULT_AUTH_BASE_URL;

  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/+$/, "") + "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    throw new Error("Invalid authBaseUrl");
  }
}

function createApiClient(authBaseUrl?: string) {
  return axios.create({
    baseURL: normalizeAuthBaseUrl(authBaseUrl),
    withCredentials: true, // Include session cookies in all requests
    headers: {
      "Content-Type": "application/json",
    },
  });
}

/**
 * Call token introspection endpoint according to RFC 7662.
 * Returns the introspection response object if active, otherwise throws.
 */
export async function introspectToken(
  token: string,
  tokenTypeHint: "access_token" | "refresh_token",
  clientId: string,
  clientSecret: string,
  authBaseUrl?: string
): Promise<any> {
  const requestBody: {
    token: string;
    token_type_hint: string;
    client_id: string;
    client_secret: string;
  } = {
    token,
    token_type_hint: tokenTypeHint,
    client_id: clientId,
    client_secret: clientSecret,
  };
  const response = await createApiClient(authBaseUrl).post(
    "introspect",
    requestBody
  );
  const data = response.data;
  if (!data || !data.active) {
    console.error("Token introspection failed:", data);
    throw new Error("Token inactive");
  }
  return data;
}
