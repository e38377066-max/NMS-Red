import { Router, type IRouter } from "express";
import { AuthSession, User, sequelize } from "../db";
import { CreateUserBody, LoginUserBody, UpdateUserBody, UpdateUserParams } from "@workspace/api-zod";
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
    if (!lockedUser.isActive) return { status: 401 as const, body: { error: "Credenciales invalidas" } };
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
        user: { id: lockedUser.id, username: lockedUser.username, role: lockedUser.role, isActive: lockedUser.isActive, createdAt: lockedUser.createdAt },
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
    attributes: ["id", "username", "role", "isActive", "createdAt"],
  });
  if (!user) {
    res.status(401).json({ error: "La cuenta ya no existe" });
    return;
  }

  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
  });
});
router.use(requireRole("admin"));

router.get("/users", async (_req, res): Promise<void> => {
  const users = await User.findAll({
    attributes: ["id", "username", "role", "isActive", "createdAt"],
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
      isActive: true,
    });
    res.status(201).json({
      id: user.id,
      username: user.username,
      role: user.role,
      isActive: user.isActive,
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

router.patch("/users/:id", async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const username = input.username?.trim();
  if (username !== undefined && username.length < 3) {
    res.status(400).json({ error: "El usuario debe tener al menos 3 caracteres" });
    return;
  }
  if (input.password !== undefined && input.password.length < 6) {
    res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    return;
  }
  const principal = res.locals.user as { id: number } | undefined;
  if (input.isActive === false && principal?.id === params.data.id) {
    res.status(400).json({ error: "No puedes desactivar tu propia cuenta" });
    return;
  }

  try {
    const result = await sequelize.transaction(async (transaction) => {
      // Lock rows in a stable order so concurrent changes cannot remove the
      // final active administrator.
      const lockedUsers = await User.findAll({
        transaction,
        lock: transaction.LOCK.UPDATE,
        order: [["id", "ASC"]],
      });
      const user = lockedUsers.find((candidate: any) => candidate.id === params.data.id);
      if (!user) return { status: 404 as const, body: { error: "Usuario no encontrado" } };

      const nextRole = input.role ?? user.role;
      const nextActive = input.isActive ?? user.isActive;
      if (user.role === "admin" && user.isActive && (nextRole !== "admin" || !nextActive)) {
        const remainingAdmins = lockedUsers.filter((candidate: any) =>
          candidate.id !== user.id && candidate.role === "admin" && candidate.isActive,
        ).length;
        if (remainingAdmins === 0) {
          return { status: 400 as const, body: { error: "Debe permanecer al menos un administrador activo" } };
        }
      }

      const changes: Record<string, unknown> = {};
      if (username !== undefined) changes.username = username;
      if (input.role !== undefined) changes.role = input.role;
      if (input.isActive !== undefined) changes.isActive = input.isActive;
      if (input.password !== undefined) changes.passwordHash = await hashPassword(input.password);
      await user.update(changes, { transaction });
      if (input.isActive === false || input.password !== undefined) {
        await AuthSession.update(
          { revokedAt: new Date() },
          { where: { userId: user.id, revokedAt: null }, transaction },
        );
      }
      return {
        status: 200 as const,
        body: {
          id: user.id,
          username: user.username,
          role: user.role,
          isActive: user.isActive,
          createdAt: user.createdAt,
        },
      };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("unique")) {
      res.status(409).json({ error: "Ese nombre de usuario ya existe" });
      return;
    }
    throw error;
  }
});

export default router;
