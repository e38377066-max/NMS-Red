import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useQueryClient } from '@tanstack/react-query';
import { useLoginUser } from '@workspace/api-client-react';

export const MOBILE_TOKEN_KEY = 'nms-field-app.access-token';
const MOBILE_USER_KEY = 'nms-field-app.user';

export type MobileUser = {
  id: number;
  username: string;
  role: string;
};

let webSession: { token: string; user: MobileUser } | null = null;

export async function getMobileAccessToken() {
  return Platform.OS === 'web'
    ? webSession?.token ?? null
    : SecureStore.getItemAsync(MOBILE_TOKEN_KEY);
}

type AuthContextValue = {
  user: MobileUser | null;
  isRestoring: boolean;
  isSigningIn: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function isMobileUser(value: unknown): value is MobileUser {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MobileUser>;
  return Number.isInteger(candidate.id)
    && typeof candidate.username === 'string'
    && typeof candidate.role === 'string';
}

async function readStoredSession() {
  if (Platform.OS === 'web') return webSession;
  const [token, serializedUser] = await Promise.all([
    SecureStore.getItemAsync(MOBILE_TOKEN_KEY),
    SecureStore.getItemAsync(MOBILE_USER_KEY),
  ]);
  if (!token || !serializedUser) return null;

  try {
    const user: unknown = JSON.parse(serializedUser);
    return isMobileUser(user) ? { token, user } : null;
  } catch {
    return null;
  }
}

async function saveStoredSession(token: string, user: MobileUser) {
  if (Platform.OS === 'web') {
    webSession = { token, user };
    return;
  }
  await Promise.all([
    SecureStore.setItemAsync(MOBILE_TOKEN_KEY, token),
    SecureStore.setItemAsync(MOBILE_USER_KEY, JSON.stringify(user)),
  ]);
}

async function clearStoredSession() {
  if (Platform.OS === 'web') {
    webSession = null;
    return;
  }
  await Promise.all([
    SecureStore.deleteItemAsync(MOBILE_TOKEN_KEY),
    SecureStore.deleteItemAsync(MOBILE_USER_KEY),
  ]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const loginMutation = useLoginUser();
  const [user, setUser] = useState<MobileUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      try {
        const session = await readStoredSession();
        if (!active) return;
        if (session && isMobileUser(session.user)) {
          setUser(session.user);
        } else {
          await clearStoredSession();
          setUser(null);
        }
      } finally {
        if (active) setIsRestoring(false);
      }
    };

    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  const signIn = async (username: string, password: string) => {
    const result = await loginMutation.mutateAsync({
      data: { username: username.trim(), password },
    });
    const nextUser = {
      id: result.user.id,
      username: result.user.username,
      role: result.user.role,
    };

    if (!result.token || !isMobileUser(nextUser)) {
      throw new Error('La respuesta de acceso no contiene una sesión válida.');
    }

    await saveStoredSession(result.token, nextUser);
    queryClient.clear();
    setUser(nextUser);
  };

  const signOut = async () => {
    await clearStoredSession();
    queryClient.clear();
    setUser(null);
  };

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isRestoring,
    isSigningIn: loginMutation.isPending,
    signIn,
    signOut,
  }), [user, isRestoring, loginMutation.isPending]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}