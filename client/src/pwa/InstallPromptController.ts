interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallPromptState {
  readonly kind: "native" | "ios" | "hidden";
  readonly installing: boolean;
  readonly error: string | null;
}

const DISMISSED_UNTIL_KEY = "naval-combat.install-dismissed-until";
const DISMISSAL_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;

export class InstallPromptController {
  private readonly listeners = new Set<() => void>();
  private readonly appDisplayMode: MediaQueryList;
  private readonly isIos: boolean;
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private installed = false;
  private installing = false;
  private error: string | null = null;
  private dismissedUntil = 0;
  private state: InstallPromptState = { kind: "hidden", installing: false, error: null };

  constructor(private readonly browser: Window) {
    const device = browser.navigator;
    this.isIos = /iPad|iPhone|iPod/.test(device.userAgent)
      || (device.platform === "MacIntel" && device.maxTouchPoints > 1);
    this.appDisplayMode = browser.matchMedia(
      "(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)",
    );
    try {
      const stored = Number(browser.localStorage.getItem(DISMISSED_UNTIL_KEY));
      if (Number.isFinite(stored)) this.dismissedUntil = stored;
    } catch {
      // Installation still works when the browser disables local storage.
    }
    // Capture the event before React or the game renderer finishes mounting.
    browser.addEventListener("beforeinstallprompt", this.onBeforeInstallPrompt);
    browser.addEventListener("appinstalled", this.onInstalled);
    browser.addEventListener("pageshow", this.publish);
    this.appDisplayMode.addEventListener("change", this.publish);
    this.publish();
  }

  readonly getSnapshot = (): InstallPromptState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly dismiss = (): void => {
    this.dismissedUntil = Date.now() + DISMISSAL_DURATION_MS;
    try {
      this.browser.localStorage.setItem(DISMISSED_UNTIL_KEY, String(this.dismissedUntil));
    } catch {
      // Keep the dismissal for this visit even if it cannot be persisted.
    }
    this.error = null;
    this.publish();
  };

  readonly install = async (): Promise<void> => {
    if (!this.deferredPrompt || this.installing || this.state.kind !== "native") return;
    const prompt = this.deferredPrompt;
    // A browser install event can be used only once.
    this.deferredPrompt = null;
    this.installing = true;
    this.error = null;
    this.publish();
    try {
      // Call synchronously from the user's click to retain browser activation.
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") this.onInstalled();
      else this.dismiss();
    } catch {
      this.error = "Installation couldn't start. Try your browser's Install app or Add to Home Screen menu.";
    } finally {
      this.installing = false;
      this.publish();
    }
  };

  dispose(): void {
    this.browser.removeEventListener("beforeinstallprompt", this.onBeforeInstallPrompt);
    this.browser.removeEventListener("appinstalled", this.onInstalled);
    this.browser.removeEventListener("pageshow", this.publish);
    this.appDisplayMode.removeEventListener("change", this.publish);
    this.listeners.clear();
  }

  private isStandalone(): boolean {
    return this.appDisplayMode.matches
      || (this.browser.navigator as Navigator & { standalone?: boolean }).standalone === true;
  }

  private readonly onBeforeInstallPrompt = (event: Event): void => {
    event.preventDefault();
    this.deferredPrompt = event as BeforeInstallPromptEvent;
    this.error = null;
    this.publish();
  };

  private readonly onInstalled = (): void => {
    this.installed = true;
    this.deferredPrompt = null;
    this.error = null;
    this.publish();
  };

  private readonly publish = (): void => {
    const hidden = !this.browser.isSecureContext || this.browser.top !== this.browser.self
      || this.installed || this.isStandalone() || Date.now() < this.dismissedUntil;
    const kind = hidden ? "hidden"
      : this.deferredPrompt || this.installing || this.error ? "native"
      : this.isIos ? "ios" : "hidden";
    if (this.state.kind === kind && this.state.installing === this.installing && this.state.error === this.error) return;
    this.state = { kind, installing: this.installing, error: this.error };
    this.listeners.forEach(listener => listener());
  };
}
