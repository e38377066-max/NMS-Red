---
name: Replit preview port routing
description: Diagnose a healthy workspace server when the Replit Preview pane still shows a port-unreachable page.
---

**Rule:** Compare the workflow port, local HTTP response, base development domain, and explicit `:5000` URL. A healthy local server and base domain can coexist with a 502 on the explicit high-port URL; use the base domain or Preview's port selector.

**Why:** In this workspace the server and container IP returned 200 on port 5000, the base `REPLIT_DEV_DOMAIN` returned 200, but the explicit `:5000` URL returned 502. Replit later normalized away the temporary port mapping, and restarting did not change the Preview pane's selected route.

**How to apply:** When Preview still shows “couldn't reach this app,” check the base development domain before changing app routes or repeating restarts. Open the base domain or click the Preview location domain and select the app's available port. Re-read `.replit` after validation or restart because Replit may normalize port mappings.