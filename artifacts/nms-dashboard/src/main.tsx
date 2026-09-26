import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { getAuthToken } from "./lib/auth";

setAuthTokenGetter(getAuthToken);

createRoot(document.getElementById("root")!).render(<App />);
