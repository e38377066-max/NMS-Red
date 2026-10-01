import assert from "node:assert/strict";
import test from "node:test";
import { encryptSecret } from "../src/services/credentials.service.ts";
import { getMikroTikTrafficSnapshot } from "../src/services/mikrotik.service.ts";

test("MikroTik traffic reads queue monitor rates and maps upload/download correctly", async () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalFetch = globalThis.fetch;
  process.env.SESSION_SECRET = "unit-test-session-secret-with-at-least-32-characters";

  let monitorRequestBody: unknown;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const { pathname } = new URL(String(input));
    if (pathname.endsWith("/rest/interface")) {
      return new Response(JSON.stringify([{ name: "ether1", running: "true" }]), { status: 200 });
    }
    if (pathname.endsWith("/rest/queue/simple")) {
      return new Response(JSON.stringify([
        { ".id": "*1", name: "TOTAL", target: "10.10.10.0/24" },
        { ".id": "*2", name: "lease-client", target: "10.10.10.25/32" },
      ]), { status: 200 });
    }
    if (pathname.endsWith("/rest/queue/simple/monitor")) {
      monitorRequestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify([
        { ".id": "*1", name: "TOTAL", target: "10.10.10.0/24", rate: "1000000/3000000" },
        { ".id": "*2", name: "lease-client", target: "10.10.10.25/32", rate: "500000/1500000" },
      ]), { status: 200 });
    }
    throw new Error(`Unexpected MikroTik request: ${pathname}`);
  }) as typeof fetch;

  try {
    const snapshot = await getMikroTikTrafficSnapshot(
      "192.0.2.1",
      "admin",
      encryptSecret("plain-test-password"),
    );

    assert.deepEqual(monitorRequestBody, { numbers: "*1,*2", once: "" });
    assert.equal(snapshot.reachable, true);
    assert.equal(snapshot.rxMbps, 3);
    assert.equal(snapshot.txMbps, 1);
    assert.equal(snapshot.clients.length, 1);
    assert.deepEqual(snapshot.clients[0], {
      key: "10.10.10.25",
      rxMbps: 1.5,
      txMbps: 0.5,
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  }
});