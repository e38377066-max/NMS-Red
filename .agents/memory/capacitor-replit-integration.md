---
name: Capacitor and Replit app integration
description: Non-obvious origin normalization and preview forwarding requirements for this workspace’s Capacitor field app.
---

## Capacitor CORS origins

**Rule:** When normalizing native CORS origins, preserve `protocol + "//" + host` when `URL.origin` returns `"null"` for an opaque custom scheme such as `capacitor://localhost`.

**Why:** Node’s WHATWG `URL` implementation returns `"null"` for that custom origin, which otherwise prevents it from matching the explicit native CORS allowlist.

**How to apply:** Keep the custom-scheme special case in the shared HTTP and Socket.IO origin policy; verify both preflight and polling requests from `capacitor://localhost`.

## Root web preview forwarding

**Rule:** The root `Start application` workflow serves port 5000, so `.replit` must map `localPort = 5000` to `externalPort = 80` for the development preview.

**Why:** The app can be healthy on localhost while Replit’s proxy returns 404 if the workflow port is not forwarded.

**How to apply:** After changing the root web server port or preview mapping, restart the workflow and check `/`, a client route, and the API health route through the preview proxy.