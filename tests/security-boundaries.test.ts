import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import * as https from "node:https";
import type { Socket } from "socket.io";
import usersRouter from "../src/routes/users.ts";
import { AuthSession, User, sequelize } from "../src/db/index.ts";
import { extractUserFromRequest, signToken } from "../src/services/auth.service.ts";
import { createSocketSessionMiddleware } from "../src/middlewares/socket-auth.ts";
import { startVm } from "../src/services/proxmox.service.ts";

function getRouteHandler(router: unknown, path: string, method: "get" | "patch") {
  const layer = (router as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods[method],
  );
  assert.ok(layer, `Expected ${method.toUpperCase()} ${path} route`);
  return layer.route.stack.at(-1).handle as (req: any, res: any) => Promise<void>;
}

function makeResponse(user = { id: 8, username: "test-admin", role: "admin" }) {
  let statusCode = 200;
  let body: unknown;
  const res = {
    locals: { user },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  };
  return { res, result: () => ({ statusCode, body }) };
}

test("session extraction rejects missing, revoked, and inactive sessions", async (t) => {
  const originalFindSession = AuthSession.findOne;
  const originalFindUser = User.findByPk;
  const originalUpdateSession = AuthSession.update;
  let session: unknown = { userId: 41 };
  let user: unknown = { id: 41, username: "current-name", role: "operator", isActive: true };
  let updateCalls = 0;

  (AuthSession as any).findOne = async () => session;
  (User as any).findByPk = async () => user;
  (AuthSession as any).update = async () => {
    updateCalls += 1;
    return [1];
  };

  try {
    const token = signToken({ id: 41, username: "old-name", role: "admin" });

    await t.test("rejects a missing or malformed bearer token", async () => {
      assert.equal(await extractUserFromRequest(), null);
      assert.equal(await extractUserFromRequest("Bearer not-a-jwt"), null);
    });

    await t.test("rejects a revoked session", async () => {
      session = null;
      assert.equal(await extractUserFromRequest(`Bearer ${token}`), null);
      assert.equal(updateCalls, 0);
    });

    await t.test("rejects an inactive account", async () => {
      session = { userId: 41 };
      user = { id: 41, username: "current-name", role: "operator", isActive: false };
      assert.equal(await extractUserFromRequest(`Bearer ${token}`), null);
      assert.equal(updateCalls, 0);
    });

    await t.test("uses current database identity and refreshes a valid session", async () => {
      session = { userId: 41 };
      user = { id: 41, username: "current-name", role: "operator", isActive: true };
      assert.deepEqual(await extractUserFromRequest(`Bearer ${token}`), {
        id: 41,
        username: "current-name",
        role: "operator",
      });
      assert.equal(updateCalls, 1);
    });
  } finally {
    (AuthSession as any).findOne = originalFindSession;
    (User as any).findByPk = originalFindUser;
    (AuthSession as any).update = originalUpdateSession;
  }
});

test("user updates cannot disable the current account or the last active administrator", async () => {
  const handler = getRouteHandler(usersRouter, "/users/:id", "patch");
  const originalTransaction = (sequelize as any).transaction;
  const originalFindAll = (User as any).findAll;
  let transactionCalls = 0;
  let updateCalls = 0;

  (sequelize as any).transaction = async (callback: (transaction: unknown) => Promise<unknown>) => {
    transactionCalls += 1;
    return callback({ LOCK: { UPDATE: "UPDATE" } });
  };
  (User as any).findAll = async () => [{
    id: 7,
    username: "only-admin",
    role: "admin",
    isActive: true,
    update: async () => { updateCalls += 1; },
  }];

  try {
    const ownAccount = makeResponse({ id: 7, username: "only-admin", role: "admin" });
    await handler({ params: { id: "7" }, body: { isActive: false } }, ownAccount.res);
    assert.equal(ownAccount.result().statusCode, 400);
    assert.equal(transactionCalls, 0);

    const lastAdmin = makeResponse({ id: 8, username: "other-admin", role: "admin" });
    await handler({ params: { id: "7" }, body: { isActive: false } }, lastAdmin.res);
    assert.equal(lastAdmin.result().statusCode, 400);
    assert.match(String((lastAdmin.result().body as { error?: string })?.error), /administrador activo/i);
    assert.equal(updateCalls, 0);
  } finally {
    (sequelize as any).transaction = originalTransaction;
    (User as any).findAll = originalFindAll;
  }
});

test("Socket.IO session middleware rejects missing or invalid tokens and accepts validated users", async (t) => {
  let resolvedHeader: string | undefined;
  const resolveUser = async (authorization?: string) => {
    resolvedHeader = authorization;
    return authorization === "Bearer valid-test-token"
      ? { id: 41, username: "test-user", role: "operator" }
      : null;
  };
  const middleware = createSocketSessionMiddleware(resolveUser);

  await t.test("rejects a missing token without querying the session resolver", async () => {
    resolvedHeader = undefined;
    const socket = { handshake: { auth: {} }, data: {} } as unknown as Socket;
    let error: Error | undefined;
    await middleware(socket, (nextError) => { error = nextError; });
    assert.equal(error?.message, "Authentication required");
    assert.equal(resolvedHeader, undefined);
  });

  await t.test("rejects an invalid or revoked token", async () => {
    const socket = { handshake: { auth: { token: "revoked-test-token" } }, data: {} } as unknown as Socket;
    let error: Error | undefined;
    await middleware(socket, (nextError) => { error = nextError; });
    assert.equal(error?.message, "Authentication required");
    assert.equal(resolvedHeader, "Bearer revoked-test-token");
  });

  await t.test("attaches the user returned by session validation", async () => {
    const socket = { handshake: { auth: { token: "valid-test-token" } }, data: {} } as unknown as Socket;
    let error: Error | undefined;
    await middleware(socket, (nextError) => { error = nextError; });
    assert.equal(error, undefined);
    assert.deepEqual(socket.data.authUser, {
      id: 41,
      username: "test-user",
      role: "operator",
    });
  });
});

test("Proxmox VM actions report HTTP failures instead of false success", async (t) => {
  const makeRequester = (statusCode: number, payload: unknown): typeof https.request => (
    ((_: unknown, onResponse: (response: any) => void) => {
      const request = new EventEmitter() as EventEmitter & {
        setTimeout: () => void;
        destroy: () => void;
        write: () => void;
        end: () => void;
      };
      request.setTimeout = () => undefined;
      request.destroy = () => undefined;
      request.write = () => undefined;
      request.end = () => {
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          statusMessage: string;
        };
        response.statusCode = statusCode;
        response.statusMessage = statusCode >= 400 ? "Internal Server Error" : "OK";
        onResponse(response);
        queueMicrotask(() => {
          response.emit("data", Buffer.from(JSON.stringify(payload)));
          response.emit("end");
        });
      };
      return request;
    }) as unknown as typeof https.request
  );

  await t.test("a non-2xx response becomes an action failure", async () => {
    const result = await startVm(
      "127.0.0.1",
      8006,
      { ticket: "test-ticket", CSRFPreventionToken: "test-csrf" },
      "test-node",
      101,
      makeRequester(500, { errors: { vmid: "not found" } }),
    );
    assert.equal(result.success, false);
    assert.match(result.message, /Proxmox API error \(500\)/);
    assert.match(result.message, /not found/);
  });

  await t.test("a successful Proxmox response remains successful", async () => {
    const result = await startVm(
      "127.0.0.1",
      8006,
      { ticket: "test-ticket", CSRFPreventionToken: "test-csrf" },
      "test-node",
      101,
      makeRequester(200, { data: "UPID:test-task" }),
    );
    assert.equal(result.success, true);
  });
});