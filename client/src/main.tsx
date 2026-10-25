import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { registerServiceWorker } from "./pwa/install";
import "./ui/styles.css";

registerServiceWorker();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
