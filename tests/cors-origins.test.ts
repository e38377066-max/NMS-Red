import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedCorsOrigin } from "../src/lib/cors-origins.ts";

test("CORS allows the local port-5000 origins without allowing arbitrary LAN origins", () => {
  assert.equal(isAllowedCorsOrigin("http://localhost:5000"), true);
  assert.equal(isAllowedCorsOrigin("http://127.0.0.1:5000"), true);
  assert.equal(isAllowedCorsOrigin("http://192.0.2.123:5000"), false);
});