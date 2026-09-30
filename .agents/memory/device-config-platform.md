---
name: Multi-firmware device configuration
description: Compatibility strategy for managing RouterOS and airOS devices without assuming one firmware version.
---

Use capability detection plus native import/export and a reviewed command path instead of hard-coding one vendor UI or firmware schema.

**Why:** RouterOS WiFi packages and airOS generations expose different configuration surfaces; applying an unverified fixed command can disconnect or brick a future device.

**How to apply:** Always redact secrets in read responses, create a private restorable backup before applying, show the proposed file/commands and warnings, and require explicit confirmation.

Live MikroTik station discovery must decrypt stored credentials and support both the legacy `wireless` and newer `wifi` registration-table endpoints.

**Why:** Managed RouterOS devices can store encrypted passwords and expose different wireless packages; a legacy-only reader can report a false “not associated” result.

**How to apply:** When adding station-based features, verify the reader uses the credential decryption boundary and probes the supported package paths before treating an empty table as no association.

## Aggregated MikroTik capacity

Record parent-child capacity allocations in NMS without changing RouterOS by default. Do not route aggregate queue changes through the generic configuration-file or script applicator.

**Why:** Aggregate queue updates need their own target selection, serialized execution, backup, explicit confirmation, verification, and recovery behavior; generic configuration application does not guarantee those safeguards.

**How to apply:** Keep capacity registration metadata-only until a dedicated parent-router operation implements those controls and is tested against failure and rollback cases.