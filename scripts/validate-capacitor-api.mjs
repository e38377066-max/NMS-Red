const value = process.env.VITE_API_BASE_URL?.trim();

if (!value) {
  console.error("Set VITE_API_BASE_URL to the public HTTPS API origin before syncing a mobile build.");
  process.exit(1);
}

try {
  const url = new URL(value);
  const isOriginOnly =
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    url.username === "" &&
    url.password === "";

  if (url.protocol !== "https:" || !isOriginOnly) {
    throw new Error("not an HTTPS origin");
  }
} catch {
  console.error("VITE_API_BASE_URL must be a public HTTPS origin, such as https://api.example.com.");
  process.exit(1);
}