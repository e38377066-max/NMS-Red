import { Capacitor } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import type { LoginResult, User } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-config";

const TOKEN_KEY = "imperio-ap.auth-token";
let activeToken: string | null = null;
let activeUser: User | null = null;
const authChangeListeners = new Set<() => void>();

function notifyAuthChanged(): void {
  authChangeListeners.forEach((listener) => listener());
}

export function subscribeAuthChanges(listener: () => void): () => void {
  authChangeListeners.add(listener);
  return () => authChangeListeners.delete(listener);
}

export function getAuthToken(): string | null {
  if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "").endsWith("/portal")) {
    return null;
  }
  return activeToken;
}

export function getCurrentUser(): User | null {
  return activeUser;
}

export async function saveAuth(result: LoginResult): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await SecureStorage.setItem(TOKEN_KEY, result.token);
  }
  activeToken = result.token;
  activeUser = result.user;
  notifyAuthChanged();
}

export async function restoreAuth(): Promise<User | null> {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const token = await SecureStorage.getItem(TOKEN_KEY);
    if (!token) return null;

    const response = await fetch(apiUrl("/api/users/me"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("La sesión expiró o fue revocada.");

    activeToken = token;
    activeUser = (await response.json()) as User;
    notifyAuthChanged();
    return activeUser;
  } catch {
    await clearAuth();
    return null;
  }
}

export async function clearAuth(): Promise<void> {
  activeToken = null;
  activeUser = null;
  notifyAuthChanged();
  if (Capacitor.isNativePlatform()) {
    try {
      await SecureStorage.removeItem(TOKEN_KEY);
    } catch {
      // The in-memory session is still cleared if the OS keychain is unavailable.
    }
  }
}

export async function logoutAuth(): Promise<void> {
  const token = activeToken;
  try {
    if (token) {
      await fetch(apiUrl("/api/users/logout"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } finally {
    await clearAuth();
  }
}