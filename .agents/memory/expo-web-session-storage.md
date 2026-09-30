---
name: Expo web session storage
description: Secure session storage differs between native Expo and the web preview.
---

Expo SecureStore is intended for native platforms and may fail at runtime in the web preview. Keep native access tokens in SecureStore; for web previews, use memory-only session state rather than falling back to localStorage.

**Why:** The web preview failed when SecureStore was called, while the app bundled and ran after isolating that path. Persisting tokens in browser storage would also weaken the intended protection.

**How to apply:** When an Expo app supports both native and web preview, branch storage by platform. Keep the web session ephemeral and require a fresh login after reload.