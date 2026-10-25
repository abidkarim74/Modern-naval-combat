import { InstallPromptController } from "./InstallPromptController";

export const installPrompt = new InstallPromptController(window);

if (import.meta.hot) import.meta.hot.dispose(() => installPrompt.dispose());

export function registerServiceWorker(): void {
  // Leave Vite's development server and hot reload out of the service worker.
  if (!import.meta.env.PROD || !window.isSecureContext || !("serviceWorker" in navigator)) return;

  const register = () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(error => console.warn("Home-screen app service worker registration failed:", error));
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
