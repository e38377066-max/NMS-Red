---
name: Replit preview port routing
description: Diagnose a healthy workspace server when the Replit Preview pane still shows a port-unreachable page.
---

**Rule:** Compare the port opened by the workflow and its local HTTP response with `.replit`'s `[[ports]]` external mapping and the port selected in Preview. If local port 5000 maps to external port 80, use the mapped web preview/base domain without `:5000`; the explicit `:5000` URL is a different route.

**Why:** In this workspace the server and container IP returned 200 on port 5000, the base `REPLIT_DEV_DOMAIN` returned 200 after mapping local 5000 to external 80, but the explicit `:5000` domain returned 502. Restarting the workflow did not change which port Preview had selected.

**How to apply:** When Preview still shows “couldn't reach this app,” avoid changing app routes after local and base-domain checks succeed. Click the Preview location domain and select the route matching the configured external mapping, or open the base development domain. Restart only after changing workflow or port configuration, not just because Preview retained an old selection.