import { getAuthToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api-config";

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const usesPortalToken = path.startsWith("/api/portal/");
  const token = usesPortalToken ? null : getAuthToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(apiUrl(path), { ...init, headers });
}