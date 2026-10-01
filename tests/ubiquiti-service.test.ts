import assert from "node:assert/strict";
import test from "node:test";
import { NodeSSH } from "node-ssh";
import { encryptSecret } from "../src/services/credentials.service.ts";
import { getUbiquitiStatus, isUbiquitiReachable } from "../src/services/ubiquiti.service.ts";

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

test("AirOS is reachable when HTTP responds but SSH and status APIs are unavailable", async () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalFetch = globalThis.fetch;
  const connectDescriptor = Object.getOwnPropertyDescriptor(NodeSSH.prototype, "connect");
  process.env.SESSION_SECRET = "unit-test-session-secret-with-at-least-32-characters";

  let rootRequested = false;
  Object.defineProperty(NodeSSH.prototype, "connect", {
    configurable: true,
    value: async () => {
      throw new Error("SSH is unavailable in this test");
    },
  });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const { pathname } = new URL(String(input));
    if (pathname === "/api/auth" || pathname === "/login.cgi") {
      return new Response(null, { status: 404 });
    }
    if (pathname === "/") {
      rootRequested = true;
      return new Response("Authentication required", { status: 401 });
    }
    throw new Error(`Unexpected Ubiquiti request: ${pathname}`);
  }) as typeof fetch;

  try {
    const status = await getUbiquitiStatus(
      "192.0.2.57",
      "admin",
      encryptSecret("plain-test-password"),
    );

    assert.equal(rootRequested, true);
    assert.equal(status.reachable, true);
    assert.equal(status.boardName, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (connectDescriptor) Object.defineProperty(NodeSSH.prototype, "connect", connectDescriptor);
    else delete (NodeSSH.prototype as Partial<NodeSSH>).connect;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  }
});

test("fast AirOS reachability accepts an HTTP response without waiting for SSH", async () => {
  const originalFetch = globalThis.fetch;
  const connectDescriptor = Object.getOwnPropertyDescriptor(NodeSSH.prototype, "connect");
  let sshAttempted = false;
  Object.defineProperty(NodeSSH.prototype, "connect", {
    configurable: true,
    value: async () => {
      sshAttempted = true;
      throw new Error("SSH should not be used when HTTP already responds");
    },
  });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const { pathname } = new URL(String(input));
    assert.equal(pathname, "/");
    return new Response("Authentication required", { status: 401 });
  }) as typeof fetch;

  try {
    assert.equal(await isUbiquitiReachable("192.0.2.57", "admin", "unused"), true);
    assert.equal(sshAttempted, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (connectDescriptor) Object.defineProperty(NodeSSH.prototype, "connect", connectDescriptor);
    else delete (NodeSSH.prototype as Partial<NodeSSH>).connect;
  }
});