import { Capacitor } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

const PORTAL_TOKEN_KEY = "imperio-ap.portal-token";
let activePortalToken: string | null = null;

export function getPortalToken(): string | null {
  return activePortalToken;
}

export async function restorePortalToken(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    activePortalToken = await SecureStorage.getItem(PORTAL_TOKEN_KEY);
    return activePortalToken;
  } catch {
    activePortalToken = null;
    return null;
  }
}

export async function savePortalToken(token: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await SecureStorage.setItem(PORTAL_TOKEN_KEY, token);
  }
  activePortalToken = token;
}

export async function clearPortalToken(): Promise<void> {
  activePortalToken = null;
  if (Capacitor.isNativePlatform()) {
    try {
      await SecureStorage.removeItem(PORTAL_TOKEN_KEY);
    } catch {
      // Keep logout effective in memory if the OS keychain is unavailable.
    }
  }
}