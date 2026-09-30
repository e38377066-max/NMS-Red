---
name: Alignment coordinate provenance
description: Keep alignment coordinates traceable to their measurement source and known accuracy.
---

Saved alignment positions must retain their origin (manual, external GPS, phone GPS, or radio GPS) and any known accuracy. Never silently discard provenance at the persistence boundary.

**Why:** Phone GPS and radio integrations can have very different accuracy; a raw coordinate reused later without its source can be mistaken for survey-grade data.

**How to apply:** When field-alignment location schemas, APIs, or screens change, preserve source and accuracy through read, edit, save, and display. Label legacy positions with unknown provenance.