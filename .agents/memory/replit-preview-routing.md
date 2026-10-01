---
name: Replit preview port routing
description: Diagnose a healthy workspace server when the Replit Preview pane still shows a port-unreachable page.
---

**Rule:** Compare the workflow's open port, local HTTP response, and base development domain. If `.replit` contains explicit `[[ports]]` mappings, include the web app's listening port mapped to external port 80; an open local port alone may not make the root development domain reachable.

**Why:** This workspace's web workflow listened successfully while `.replit` mapped only other ports, and the root development domain returned 502. An explicit mapping for the web port restored the domain health response.

**How to apply:** Inspect `.replit` and the workflow's reported open port, then check both local health and `REPLIT_DEV_DOMAIN/api/readyz` after one restart. If the app is healthy but a request fails before appearing in workflow logs, diagnose preview routing rather than changing application routes or restarting repeatedly.