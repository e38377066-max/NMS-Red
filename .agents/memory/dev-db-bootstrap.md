---
name: Imported NMS database bootstrap
description: Development database initialization needed after importing the NMS workspace
---

An imported NMS workspace may connect to a provisioned but empty development PostgreSQL database. The API can start successfully while all database-backed screens fail until the Drizzle schema is pushed.

**Why:** The server starts its monitoring, billing, and backup loops independently of schema initialization, so missing tables surface as runtime 500s rather than startup failures.

**How to apply:** When an imported NMS preview reports missing `equipment` or related relations, inspect the development schema and run the documented development-only Drizzle push before debugging feature code. Do not apply that workflow to production.