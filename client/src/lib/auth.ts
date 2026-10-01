import type { LoginResult, User } from "@workspace/api-client-react";

const TOKEN_KEY = "isp-cockpit-token";
const USER_KEY = "isp-cockpit-user";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getCurrentUser(): User | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(USER_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as User;
  } catch {
    return null;
  }
}

export function saveAuth(result: LoginResult): void {
  window.localStorage.setItem(TOKEN_KEY, result.token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(result.user));
}

export function clearAuth(): void {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}