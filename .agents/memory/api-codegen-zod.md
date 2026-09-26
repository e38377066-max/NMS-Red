---
name: OpenAPI codegen and Zod compatibility
description: The workspace uses Zod 3 while the current Orval output can emit Zod 4-style helpers and duplicate barrel exports
---

The OpenAPI generation step needs a compatibility pass after Orval writes files: map `zod.int()` to `zod.number().int()` and avoid re-exporting operation schemas that are already exported from the generated API module.

**Why:** The workspace catalog intentionally pins Zod 3, while newer Orval output assumes helpers introduced by Zod 4 and regenerates ambiguous barrel exports. A plain codegen run can therefore make every library typecheck fail.

**How to apply:** Keep the compatibility pass in the `@workspace/api-spec` codegen command and run codegen after every OpenAPI change so generated client hooks and Zod schemas remain synchronized.