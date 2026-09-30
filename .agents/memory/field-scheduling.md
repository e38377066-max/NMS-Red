---
name: Field technician scheduling
description: Product rules for dated availability blocks and field-work-order scheduling.
---

Use explicit start/end date-time blocks for technician availability. A scheduled order assigned to a person must fit within one of that person's availability blocks and must not overlap another active order. Availability blocks for the same person cannot overlap, and a block cannot be removed while an active order overlaps it. Until a dedicated technician role is approved, use the existing user accounts as assignable personnel.

**Why:** The product owner chose date-and-time blocks rather than recurring weekly hours. The existing user model has only admin and operator roles, so adding a new role would change account policy beyond the requested scope. Full containment and overlap checks avoid unstaffed appointments and double-booking.

**How to apply:** Keep future field scheduling changes consistent with these rules. Do not add recurring availability or a new technician role without product direction.