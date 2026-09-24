---
name: Workspace install firewall
description: Recovery guidance when a codegen-only workspace dependency is blocked during a full pnpm install
---

When the package firewall blocks a codegen-only dependency, install the runnable app and API workspace subtrees with pnpm filters first; keep the codegen package declared and do not bypass the firewall.

**Why:** A blocked development-only package can prevent all workspace symlinks from being created, leaving otherwise runnable artifacts without Vite, esbuild, or their runtime dependencies.

**How to apply:** Verify the blocked package is only needed for code generation, install the runtime artifact filters, and separately resolve the missing direct runtime dependencies before starting workflows.