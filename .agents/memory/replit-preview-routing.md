---
name: Replit preview port routing
description: Diagnose a healthy workspace server when the Replit Preview pane still shows a port-unreachable page.
---

**Rule:** Compare the workflow's open port, local HTTP response, and base development domain. A root workflow may not expose the shared proxy on `localhost:80`; check `https://$REPLIT_DEV_DOMAIN/<path>` as well. If `.replit` contains explicit `[[ports]]` mappings, include the web app's listening port mapped to external port 80.

**Why:** This workspace's web workflow has had both a missing external port mapping (causing a domain 502) and a shell environment where `localhost:80` refused connections while the development domain returned 200. A healthy server can therefore disagree with either preview route.

**How to apply:** Inspect `.replit` and the workflow's reported open port, then check local health when available and `REPLIT_DEV_DOMAIN/api/readyz` after one restart. If the app is healthy but a request fails before appearing in workflow logs, diagnose preview routing rather than changing application routes or restarting repeatedly.