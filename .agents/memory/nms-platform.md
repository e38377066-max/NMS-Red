---
name: NMS Multi-Brand Platform
description: Key decisions and quirks for the ISP Cockpit NMS platform (MikroTik + Ubiquiti + Proxmox)
---

## SSH/Native Module Bundling with esbuild

**Rule:** When using packages with native binaries (ssh2, cpu-features, net-snmp) AND packages that import them (node-ssh), BOTH the native package AND its importer must be added to esbuild's `external` list. If only the native package is external, esbuild inlines the importer's code, and at runtime Node.js can't resolve the native package from the dist/ directory (pnpm stores them only accessible from their proper location in the virtual store).

**Why:** pnpm's strict mode means transitive dependencies (like `ssh2`) are only symlinked into the virtual store, not into the direct dependant's node_modules. When esbuild inlines `node-ssh` but keeps `ssh2` external, the bundled code tries to import `ssh2` from `dist/index.mjs` which can't find it.

**How to apply:** For any package with native binaries, add BOTH the package AND all packages that import it to `external` in `build.mjs`. Also add `cpu-features`, `ssh2`, `net-snmp` to `onlyBuiltDependencies` in `pnpm-workspace.yaml`.

## Ubiquiti AirOS

HTTP approach (faster): POST /login.cgi → get cookie → GET /status.cgi or /sta.cgi for wireless table.
SSH fallback: `wstalist` command returns JSON. `mca-status` for device status. Older SSH key algorithms needed: diffie-hellman-group1-sha1, ssh-rsa, 3des-cbc.

## Network Equipment Role Hierarchy

Roles in DB: gateway | core_router | ptp_link | ap_distributor
Operational order: Router central MikroTik hEX (core_router) → LiteAP/SXT (ap_distributor) → Cliente. Proxmox remains legacy backend support, not part of the primary network flow.

**Rule:** A client must be assigned to a MikroTik equipment with role `core_router`; wireless equipment is monitored separately and must not control client queues, DHCP, suspension, or reactivation.

**Why:** The hEX is the device that owns RouterOS queues, DHCP, and billing enforcement even when the client reaches the network through a LiteAP or SXT.

**How to apply:** Keep `clients.equipmentId` pointing to the central hEX for current operations. Add a separate wireless-equipment relationship when client-to-AP/SXT association is needed without changing the controller.

## DB Schema Key Fields

equipment table: connectionType (mikrotik_routeros | ubiquiti_airos), equipmentRole, snmpCommunity, apiPort
