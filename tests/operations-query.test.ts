import assert from "node:assert/strict";
import test from "node:test";
import operationsRouter from "../src/routes/operations.ts";
import { sequelize } from "../src/db/index.ts";

function getGetHandler(path: string) {
  const layer = (operationsRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods.get,
  );
  assert.ok(layer, `Expected GET ${path} route`);
  return layer.route.stack.at(-1).handle as (req: any, res: any) => Promise<void>;
}

function makeResponse() {
  let body: unknown;
  const res = {
    locals: { user: { id: 8, username: "test-user", role: "operator" } },
    status() { return this; },
    json(value: unknown) { body = value; return this; },
  };
  return { res, result: () => body };
}

test("client history joins the changing user by column without binding a column value", async () => {
  const originalQuery = (sequelize as any).query;
  const queries: Array<{ sql: string; bind: unknown[] }> = [];
  (sequelize as any).query = async (sql: string, options: { bind?: unknown[] }) => {
    queries.push({ sql, bind: options.bind ?? [] });
    return queries.length === 1 ? [{ id: 42 }] : [];
  };

  try {
    const response = makeResponse();
    await getGetHandler("/clients/:id/history")({ params: { id: "42" } }, response.res);

    assert.deepEqual(response.result(), []);
    assert.equal(queries.length, 2);
    assert.deepEqual(queries[0].bind, [42]);
    assert.match(
      queries[1].sql,
      /LEFT JOIN "users" AS "t_users" ON "t_users"\."id" = "t_client_change_history"\."changed_by_user_id"/,
    );
    assert.deepEqual(queries[1].bind, [42]);
  } finally {
    (sequelize as any).query = originalQuery;
  }
});