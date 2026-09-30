---
name: Field technician scheduling
description: Product rules for dated availability blocks and field-work-order scheduling.
---

Use explicit start/end date-time blocks for technician availability. A scheduled order assigned to a person must fit within one of that person's availability blocks and must not overlap another active order. Availability blocks for the same person cannot overlap, and a block cannot be removed while an active order overlaps it. Until a dedicated technician role is approved, use the existing user accounts as assignable personnel.

**Why:** The product owner chose date-and-time blocks rather than recurring weekly hours. The existing user model has only admin and operator roles, so adding a new role would change account policy beyond the requested scope. Full containment and overlap checks avoid unstaffed appointments and double-booking.

**How to apply:** Keep future field scheduling changes consistent with these rules. Do not add recurring availability or a new technician role without product direction.

## Installation measurements and equipment capture

Keep signal strength (dBm) and CCQ as separate visit measurements from the existing measured-power field. Store installed equipment name and serial number as work-order snapshots; do not change inventory quantities or statuses as a side effect.

**Why:** The order model already contains a separate measured-power value, and inventory movement workflows are not implemented. Reusing that field could conflate measurements, while silently consuming stock would misrepresent inventory.

**How to apply:** Future inventory integration should add an explicit movement/assignment workflow before changing stock. Keep the visit's model and serial snapshot available even if linked inventory support is added later.

## Visit history

Use finalized field work orders as visit-history entries instead of duplicating them in a second visit table. A technician completes the order, and its completion timestamp is retained for history sorting and display.

**Why:** A field order already contains the client, schedule, technician, signal/CCQ, equipment, serial, and notes for one visit. A parallel log would create two records that could disagree.

**How to apply:** Keep the one-order-per-visit assumption. If the product later needs multiple attempts or follow-up events under one work order, introduce an explicit visit-event model rather than silently duplicating order rows.

## Client relocation

A relocation order must identify an existing client and a destination address. Only explicit completion updates the client's installation address; record the old and new addresses in client change history, and do not change IP, MAC, equipment/AP assignments, or router configuration.

**Why:** The administrative address should follow a confirmed physical move, while network changes require a separately reviewed workflow and must not happen implicitly.

**How to apply:** Require a client and destination when creating a relocation. On completion, update the address and history atomically, confirm the change in the UI, and leave network and inventory state untouched.