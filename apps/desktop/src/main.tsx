import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initAuth } from "./auth";
import { initPlatform } from "./platform";
import "./styles.css";

const platform = await initPlatform();
initAuth(platform);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
