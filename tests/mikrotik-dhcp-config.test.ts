import assert from "node:assert/strict";
import test from "node:test";
import { encryptSecret } from "../src/services/credentials.service.ts";
import { readMikroTikDhcpConfig } from "../src/services/mikrotik.service.ts";

test("MikroTik DHCP discovery returns pools and excludes disabled, invalid, or stopped servers", async () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalFetch = globalThis.fetch;
  process.env.SESSION_SECRET = "unit-test-session-secret-with-at-least-32-characters";

  const requests: Array<{ path: string; method: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const { pathname } = new URL(String(input));
    requests.push({ path: pathname, method: init?.method ?? "GET" });
    if (pathname.endsWith("/rest/ip/dhcp-server")) {
      return new Response(JSON.stringify([
        { name: "dhcp-main", interface: "bridge", "address-pool": "pool-main", disabled: "false", invalid: "false", running: "true" },
        { name: "dhcp-disabled", interface: "ether2", "address-pool": "pool-old", disabled: "true", invalid: "false", running: "true" },
        { name: "dhcp-stopped", interface: "ether3", "address-pool": "pool-old", disabled: "false", invalid: "false", running: "false" },
        { name: "dhcp-invalid", interface: "ether4", "address-pool": "pool-old", disabled: "false", invalid: "true", running: "true" },
        { name: "dhcp-enabled", interface: "ether5", "address-pool": "static-only", disabled: "false", invalid: "false" },
      ]), { status: 200 });
    }
    if (pathname.endsWith("/rest/ip/pool")) {
      return new Response(JSON.stringify([
        { name: "pool-main", ranges: "192.168.88.100-192.168.88.200" },
        { name: "pool-old", ranges: "192.168.89.100-192.168.89.200" },
      ]), { status: 200 });
    }
    throw new Error(`Unexpected MikroTik request: ${pathname}`);
  }) as typeof fetch;

  try {
    const config = await readMikroTikDhcpConfig(
      "192.0.2.1",
      "admin",
      encryptSecret("plain-test-password"),
    );

    assert.deepEqual(config.servers.map((server) => [server.name, server.active, server.running]), [
      ["dhcp-main", true, true],
      ["dhcp-disabled", false, true],
      ["dhcp-stopped", false, false],
      ["dhcp-invalid", false, true],
      ["dhcp-enabled", false, null],
    ]);
    assert.deepEqual(config.pools, [
      { name: "pool-main", ranges: "192.168.88.100-192.168.88.200" },
      { name: "pool-old", ranges: "192.168.89.100-192.168.89.200" },
    ]);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.method === "GET"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  }
});