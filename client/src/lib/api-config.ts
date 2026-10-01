import { Capacitor } from "@capacitor/core";

type ApiConfiguration = {
  baseUrl: string | null;
  error: string | null;
};

function resolveApiConfiguration(): ApiConfiguration {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!raw) {
    return Capacitor.isNativePlatform()
      ? {
          baseUrl: null,
          error: "La app móvil necesita VITE_API_BASE_URL con el origen HTTPS público del API antes de compilar.",
        }
      : { baseUrl: null, error: null };
  }

  try {
    const parsed = new URL(raw);
    const isLocalHttp =
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);

    if (parsed.protocol !== "https:" && !isLocalHttp) {
      throw new Error("Usa HTTPS para VITE_API_BASE_URL.");
    }
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("VITE_API_BASE_URL debe contener solo el origen, sin ruta, credenciales ni parámetros.");
    }

    return { baseUrl: parsed.origin, error: null };
  } catch (cause) {
    return {
      baseUrl: null,
      error: cause instanceof Error ? cause.message : "VITE_API_BASE_URL no es una URL válida.",
    };
  }
}

const configuration = resolveApiConfiguration();

export const API_BASE_URL = configuration.baseUrl;
export const API_CONFIGURATION_ERROR = configuration.error;

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error("Las rutas del API deben comenzar con /.");
  }
  if (API_CONFIGURATION_ERROR) {
    throw new Error(API_CONFIGURATION_ERROR);
  }
  return `${API_BASE_URL ?? ""}${path}`;
}