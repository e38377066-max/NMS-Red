---
name: DHCP lease and queue identity
description: The canonical relationship between registered clients, MikroTik DHCP leases, and Simple Queues.
---

Treat the registered client name/comment as the stable DHCP identity; use the current lease IP and MAC as matching data, while the per-client speed is stored in the lease `rate-limit` under the global parent queue.

**Why:** The live router uses DHCP lease `rate-limit` values and one global `TOTAL` queue; creating per-client Simple Queues would diverge from the real traffic model. A client can also receive a new lease address before it is made static.

**How to apply:** Set the DHCP comment to the client name, update the lease `rate-limit`, inherit the router's parent queue/address-list template for new leases, and match by IP, MAC, name, or comment during speed, suspension, and reactivation operations.

## Lease assignment classification

Classify RouterOS leases literally: `dynamic=true` means unassigned/dynamic, and `dynamic=false` means assigned/static. A failed read or missing lease is unknown, never static.

**Why:** RouterOS lease flags are the source of truth; interpreting an outage or absent record as a static assignment would create false client status.

**How to apply:** Keep live lease state separate from stored client data, refresh it periodically, and expose unavailable or missing readings as a separate state.