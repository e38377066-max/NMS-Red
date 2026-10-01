import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { getAuthToken } from "./lib/auth";
import { API_BASE_URL } from "./lib/api-config";

setBaseUrl(API_BASE_URL);
setAuthTokenGetter(getAuthToken);

createRoot(document.getElementById("root")!).render(<App />);
