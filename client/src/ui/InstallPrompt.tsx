import { useState, useSyncExternalStore } from "react";
import { installPrompt } from "../pwa/install";

export function InstallPrompt() {
  const { kind, installing, error } = useSyncExternalStore(installPrompt.subscribe, installPrompt.getSnapshot);
  const [showSteps, setShowSteps] = useState(false);
  if (kind === "hidden") return null;

  return (
    <section className="install-prompt" aria-labelledby="install-title"
      onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
      <div className="install-heading">
        <img src="/icons/icon-192.png" width="52" height="52" alt="" />
        <div>
          <p className="eyebrow">Naval Combat</p>
          <h2 id="install-title">Add to Home Screen</h2>
        </div>
      </div>
      <p className="install-description" role="status">
        Keep Naval Combat one tap away. Open it from your home screen in its own app window.
      </p>
      {kind === "ios" && showSteps && <ol className="install-steps">
        <li>Open this page in <strong>Safari</strong>.</li>
        <li>Tap <strong>Share</strong> (you may find it in the page menu).</li>
        <li>Choose <strong>Add to Home Screen</strong>.</li>
        <li>Keep <strong>Open as Web App</strong> enabled if shown, then tap <strong>Add</strong>.</li>
      </ol>}
      {error && <p className="install-error" role="alert">{error}</p>}
      <div className="install-actions">
        {kind === "native" && !error && <button type="button" className="install-primary"
          disabled={installing} onClick={() => { void installPrompt.install(); }}>
          {installing ? "Installing…" : "Install app"}
        </button>}
        {kind === "ios" && !showSteps && <button type="button" className="install-primary"
          onClick={() => setShowSteps(true)}>Show steps</button>}
        <button type="button" className="install-dismiss" disabled={installing} onClick={installPrompt.dismiss}>
          {showSteps || error ? "Got it" : "Not now"}
        </button>
      </div>
    </section>
  );
}
