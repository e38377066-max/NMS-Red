---
name: Multi-firmware device configuration
description: Compatibility strategy for managing RouterOS and airOS devices without assuming one firmware version.
---

Use capability detection plus native import/export and a reviewed command path instead of hard-coding one vendor UI or firmware schema.

**Why:** RouterOS WiFi packages and airOS generations expose different configuration surfaces; applying an unverified fixed command can disconnect or brick a future device.

**How to apply:** Always redact secrets in read responses, create a private restorable backup before applying, show the proposed file/commands and warnings, and require explicit confirmation.