import axios from "axios";
const BASE_URL = "https://auth.blitzware.xyz/api/auth/";

// Configure axios instance with credentials for session support
const apiClient = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // Include session cookies in all requests
  headers: {
    "Content-Type": "application/json",
  },
});

/**
 * Call token introspection endpoint according to RFC 7662.
 * Returns the introspection response object if active, otherwise throws.
 */
export async function introspectToken(
  token: string,
  tokenTypeHint: "access_token" | "refresh_token",
  clientId: string,
  clientSecret: string
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
  const response = await apiClient.post("introspect", requestBody);
  const data = response.data;
  if (!data || !data.active) {
    console.error("Token introspection failed:", data);
    throw new Error("Token inactive");
  }
  return data;
}
