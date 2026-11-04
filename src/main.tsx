import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/editor.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Test and debugging hook (used by the Playwright suite).
import { useStore } from "./state/store";
declare global {
  interface Window {
    __margin?: { store: typeof useStore };
  }
}
window.__margin = { store: useStore };
