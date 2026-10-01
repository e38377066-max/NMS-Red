import { Router, type IRouter } from "express";
import { User, sequelize } from "../db";
import { CreateUserBody, LoginUserBody } from "@workspace/api-zod";
import { createSession, hashPassword, revokeSession, signToken, verifyPassword } from "../services/auth.service";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/users/login", async (req, res): Promise<void> => {
  const parsed = LoginUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await User.findOne({ where: { username: parsed.data.username } });

  if (!user) {
    res.status(401).json({ error: "Credenciales invalidas" });
    return;
  }
  const result = await sequelize.transaction(async (transaction) => {
    const lockedUser = await User.findOne({
      where: { id: user.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!lockedUser) return { status: 401 as const, body: { error: "Credenciales invalidas" } };
    if (lockedUser.lockedUntil && lockedUser.lockedUntil > new Date()) {
      return { status: 423 as const, body: { error: "Cuenta bloqueada temporalmente por intentos fallidos" } };
    }
    const valid = await verifyPassword(parsed.data.password, lockedUser.passwordHash);
    if (!valid) {
      const attempts = lockedUser.failedLoginAttempts + 1;
      await lockedUser.update({
        failedLoginAttempts: attempts >= 5 ? 0 : attempts,
        lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
      }, { transaction });
      return { status: 401 as const, body: { error: "Credenciales invalidas" } };
    }
    if (lockedUser.failedLoginAttempts > 0 || lockedUser.lockedUntil) {
      await lockedUser.update({ failedLoginAttempts: 0, lockedUntil: null }, { transaction });
    }
    const authUser = { id: lockedUser.id, username: lockedUser.username, role: lockedUser.role };
    const token = signToken(authUser);
    await createSession(token, authUser, {
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    }, transaction);
    return {
      status: 200 as const,
      body: {
        token,
        user: { id: lockedUser.id, username: lockedUser.username, role: lockedUser.role, createdAt: lockedUser.createdAt },
      },
    };
  });
  res.status(result.status).json(result.body);
});

router.post("/users/logout", async (req, res): Promise<void> => {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    await revokeSession(authorization.slice(7));
  }
  res.sendStatus(204);
});

router.use(requireAuth);
router.get("/users/me", async (_req, res): Promise<void> => {
  const principal = res.locals.user as { id: number } | undefined;
  if (!principal) {
    res.status(401).json({ error: "Autenticación requerida" });
    return;
  }

  const user = await User.findByPk(principal.id, {
    attributes: ["id", "username", "role", "createdAt"],
  });
  if (!user) {
    res.status(401).json({ error: "La cuenta ya no existe" });
    return;
  }

  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
  });
});
router.use(requireRole("admin"));

router.get("/users", async (_req, res): Promise<void> => {
  const users = await User.findAll({
    attributes: ["id", "username", "role", "createdAt"],
    order: [["username", "ASC"]],
  });
  res.json(users);
});

router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.username.trim().length < 3 || parsed.data.password.length < 6) {
    res.status(400).json({ error: "El usuario debe tener 3 caracteres y la contraseña 6 como mínimo" });
    return;
  }
  const passwordHash = await hashPassword(parsed.data.password);
  try {
    const user = await User.create({
      username: parsed.data.username.trim(),
      passwordHash,
      role: parsed.data.role,
    });
    res.status(201).json({
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
    });
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("unique")) {
      res.status(409).json({ error: "Ese nombre de usuario ya existe" });
      return;
    }
    throw error;
  }
});

export default router;
