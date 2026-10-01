import assert from "node:assert/strict";
import test from "node:test";
import { encryptSecret } from "../src/services/credentials.service.ts";
import { getUbiquitiStatus } from "../src/services/ubiquiti.service.ts";

test("Ubiquiti modern HTTP auth sends decrypted stored credentials", async () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalFetch = globalThis.fetch;
  process.env.SESSION_SECRET = "unit-test-session-secret-with-at-least-32-characters";

  let authBody: { username: string; password: string } | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const { pathname } = new URL(String(input));
    if (pathname === "/api/auth") {
      authBody = JSON.parse(String(init?.body)) as typeof authBody;
      return new Response(null, {
        status: 200,
        headers: { "set-cookie": "session=test-session" },
      });
    }
    if (pathname === "/status.cgi") {
      return new Response(JSON.stringify({
        host: { hostname: "test-ap", fwversion: "6.3.11", uptime: 120 },
        wireless: { frequency: "5800", txpower: 20 },
        system: { cpu: 4 },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected Ubiquiti request: ${pathname}`);
  }) as typeof fetch;

  try {
    const status = await getUbiquitiStatus(
      "192.0.2.10",
      "admin",
      encryptSecret("plain-test-password"),
    );

    assert.deepEqual(authBody, { username: "admin", password: "plain-test-password" });
    assert.equal(status.reachable, true);
    assert.equal(status.boardName, "test-ap");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  }
});