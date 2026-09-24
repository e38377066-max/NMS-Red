---
name: DHCP lease and queue identity
description: The canonical relationship between registered clients, MikroTik DHCP leases, and Simple Queues.
---

Treat the registered client name/comment as the stable queue identity; use the current static DHCP IP and MAC as matching and targeting data, not as the only identity.

**Why:** A client can receive a new lease address before it is made static, so matching only by its old IP leaves duplicate or orphaned Simple Queues.

**How to apply:** Set the DHCP comment to the client name, create or update the named queue when the lease becomes static, and match by IP, MAC, name, or comment during speed, suspension, and reactivation operations.