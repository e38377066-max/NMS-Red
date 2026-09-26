import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, parsed.data.username));

  if (!user) {
    res.status(401).json({ error: "Credenciales invalidas" });
    return;
  }
  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Credenciales invalidas" });
    return;
  }
  const token = signToken({ id: user.id, username: user.username, role: user.role });
  await createSession(token, { id: user.id, username: user.username, role: user.role }, {
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt },
  });
});

router.post("/users/logout", async (req, res): Promise<void> => {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    await revokeSession(authorization.slice(7));
  }
  res.sendStatus(204);
});

router.use(requireAuth);
router.use(requireRole("admin"));

router.get("/users", async (_req, res): Promise<void> => {
  const users = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(usersTable.username);
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
    const [user] = await db
      .insert(usersTable)
      .values({ username: parsed.data.username.trim(), passwordHash, role: parsed.data.role })
      .returning({ id: usersTable.id, username: usersTable.username, role: usersTable.role, createdAt: usersTable.createdAt });
    res.status(201).json(user);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("unique")) {
      res.status(409).json({ error: "Ese nombre de usuario ya existe" });
      return;
    }
    throw error;
  }
});

export default router;
