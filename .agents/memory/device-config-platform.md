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

## Central router tunnel constraint

The central MikroTik for this project is an hEX RB750Gr3 on RouterOS 7.18.2 (`mmips`). RouterOS containers support ARM, ARM64, and x86, so do not plan to host a tunnel container on this router.

**Why:** The router's architecture is outside RouterOS container support, and Railway has no direct private route to a LAN behind NAT. Outbound telemetry does not provide interactive network access.

**How to apply:** Before implementing Railway-to-LAN access, confirm public WAN reachability or upstream UDP forwarding and evaluate a RouterOS-native WireGuard endpoint plus a Railway-side client. Never expose RouterOS REST/SSH directly; a dedicated VPN port requires explicit user approval.

## Local REST transport

The current LAN RouterOS REST endpoint responds on HTTP port 80 (an unauthenticated request returns 401); TCP port 443 is reachable but its TLS handshake fails. The local app can use HTTP without router changes, but RouterOS Basic Auth credentials are unencrypted on that connection.

**Why:** Windows-side checks confirmed the REST endpoint on port 80 and a TLS alert on port 443.

**How to apply:** Limit HTTP/80 use to a trusted private LAN, never expose or port-forward the management endpoint to the Internet, and keep HTTPS for any deployment where LAN trust cannot be assumed.

## Aggregated MikroTik capacity

Record parent-child capacity allocations in NMS without changing RouterOS by default. Do not route aggregate queue changes through the generic configuration-file or script applicator.

**Why:** Aggregate queue updates need their own target selection, serialized execution, backup, explicit confirmation, verification, and recovery behavior; generic configuration application does not guarantee those safeguards.

**How to apply:** Keep capacity registration metadata-only until a dedicated parent-router operation implements those controls and is tested against failure and rollback cases.