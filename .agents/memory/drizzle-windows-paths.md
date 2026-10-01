---
name: Drizzle schema paths on Windows
description: Reliable Drizzle Kit schema path configuration when running package scripts on Windows.
---

Use a schema path relative to the database package working directory, such as `./src/schema/index.ts`. Drizzle Kit resolves schema entries through a glob scan; on Windows, an absolute path produced by `path.join(__dirname, ...)` contains backslashes and may fail discovery even when the file exists and is tracked.

**Why:** The local Windows PostgreSQL initializer reached Drizzle after database authentication succeeded, then stopped at schema discovery without applying the schema.

**How to apply:** Keep Drizzle CLI runs scoped to the database package directory and prefer a package-relative schema path. If changing how the CLI is launched, preserve that working directory or adjust the config and verify on Windows.