import type { Socket } from "socket.io";
import { extractUserFromRequest, type AuthUser } from "../services/auth.service";

type UserResolver = (authorization?: string) => Promise<AuthUser | null>;

export function createSocketSessionMiddleware(
  resolveUser: UserResolver = extractUserFromRequest,
) {
  return async (socket: Socket, next: (error?: Error) => void): Promise<void> => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string" || token.length === 0) {
      next(new Error("Authentication required"));
      return;
    }

    try {
      const user = await resolveUser(`Bearer ${token}`);
      if (!user) {
        next(new Error("Authentication required"));
        return;
      }
      socket.data.authUser = user;
      next();
    } catch {
      next(new Error("Authentication required"));
    }
  };
}