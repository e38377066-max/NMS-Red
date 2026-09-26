import type { RequestHandler } from "express";
import { extractUserFromRequest } from "../services/auth.service";

export type AuthenticatedUser = {
  id: number;
  username: string;
  role: string;
};

export const requireAuth: RequestHandler = (req, res, next) => {
  const user = extractUserFromRequest(req.headers.authorization);
  if (!user) {
    res.status(401).json({ error: "Autenticación requerida" });
    return;
  }
  res.locals.user = user satisfies AuthenticatedUser;
  next();
};

export function requireRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    const user = res.locals.user as AuthenticatedUser | undefined;
    if (!user) {
      res.status(401).json({ error: "Autenticación requerida" });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: "No tienes permisos para esta operación" });
      return;
    }
    next();
  };
}