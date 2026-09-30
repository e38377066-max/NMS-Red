---
name: Ticket attachment storage
description: Storage boundary for private support-ticket files and Railway deployment.
---

Use a dedicated filesystem directory for new ticket attachments, configured with `TICKET_ATTACHMENT_STORAGE_DIR`. Do not change the shared `BACKUP_STORAGE_PROVIDER` for ticket uploads.

**Why:** The project owner chose a separate folder on the Railway-hosted API disk so support files do not redirect or alter backup storage. Replit published filesystems are ephemeral; production ticket files need a Railway persistent volume.

**How to apply:** Mount a persistent Railway volume (for example at `/data`) and point `TICKET_ATTACHMENT_STORAGE_DIR` to a private subdirectory (for example `/data/support-ticket-attachments`). Keep existing `fs://` and `s3://` attachment paths readable during transition.