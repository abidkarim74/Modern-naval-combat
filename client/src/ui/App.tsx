import { useEffect, useRef, useState } from "react";
import { createRenderer } from "../engine/createRenderer";
import type { Renderer, RendererBackend } from "../engine/createRenderer";
import { GameSession } from "../game/GameSession";
import type { GameTelemetry } from "../game/GameSession";
import { DEFAULT_GRAPHICS_QUALITY } from "../game/graphicsQuality";
import type { GraphicsQuality } from "../game/graphicsQuality";

type GameStatus =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly backend: RendererBackend }
  | { readonly state: "error"; readonly message: string };

const EMPTY_TELEMETRY: GameTelemetry = {
  speedKnots: 0,
  throttlePercent: 0,
  distanceMeters: 0,
  rudderDegrees: 0,
  headingDegrees: 0,
  fps: 0,
  frameTimeMs: 0,
  activeMeshes: 0,
  activeParticles: 0,
  simulationTimeMs: 0,
  soundStatus: "off",
  activeBirds: 0,
  cameraView: "chase",
  missiles: {
    forwardRemaining: 32,
    aftRemaining: 64,
    cooldownSeconds: 0,
    activeMissiles: 0,
    lastLaunchBank: null,
    phase: null,
  },
};

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<GameSession | undefined>(undefined);
  const [status, setStatus] = useState<GameStatus>({ state: "loading" });
  const [telemetry, setTelemetry] = useState<GameTelemetry>(EMPTY_TELEMETRY);
  const [quality, setQuality] = useState<GraphicsQuality>(DEFAULT_GRAPHICS_QUALITY);
  const [volume, setVolume] = useState(75);
  const cameraView = telemetry.cameraView;
  const isIslandView = cameraView === "island";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let renderer: Renderer | undefined;
    let session: GameSession | undefined;
    let handleResize: (() => void) | undefined;

    const initialize = async () => {
      try {
        renderer = await createRenderer(canvas);
        if (disposed) {
          renderer.engine.dispose();
          return;
        }

        session = new GameSession(renderer.engine, renderer.backend, setTelemetry);
        sessionRef.current = session;
        const activeRenderer = renderer;
        const activeSession = session;
        activeRenderer.engine.runRenderLoop(() => {
          activeSession.update(activeRenderer.engine.getDeltaTime() / 1_000);
          activeSession.scene.render();
        });
        handleResize = () => activeRenderer.engine.resize();
        window.addEventListener("resize", handleResize);
        setStatus({ state: "ready", backend: renderer.backend });
      } catch (error) {
        console.error("Game initialization failed:", error);
        session?.dispose();
        renderer?.engine.dispose();
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        setStatus({ state: "error", message });
      }
    };

    void initialize();

    return () => {
      disposed = true;
      if (handleResize) window.removeEventListener("resize", handleResize);
      if (sessionRef.current === session) sessionRef.current = undefined;
      session?.dispose();
      renderer?.engine.dispose();
    };
  }, []);

  const updateQuality = (qualityName: string) => {
    if (!isGraphicsQuality(qualityName)) return;
    sessionRef.current?.setQuality(qualityName);
    setQuality(qualityName);
  };

  const toggleCameraView = () => {
    const next = cameraView === "chase" ? "forward" : "chase";
    sessionRef.current?.setCameraView(next);
  };

  const toggleMissileTracking = () => {
    const next = cameraView === "missile" ? "chase" : "missile";
    sessionRef.current?.setCameraView(next);
  };

  const heading = String(Math.round(telemetry.headingDegrees) % 360).padStart(3, "0");
  const missileFlightStatus = telemetry.missiles.phase === "boost" ? "Vertical climb"
    : telemetry.missiles.phase === "turn" ? "Turning to course"
    : telemetry.missiles.phase === "cruise" ? "Cruising outbound"
    : telemetry.missiles.phase === "expired" ? "Flight complete"
    : "Launchers ready";
  const missileCoolingDown = telemetry.missiles.cooldownSeconds > 0;

  return (
    <main className={`game-shell${isIslandView ? " island-view" : ""}`}>
      <canvas ref={canvasRef} className="render-canvas" aria-label={isIslandView ? "North Watch opponent island base, orbit and zoom view" : "Third-person naval sea trial"} />

      <header className="identity-panel hud-panel">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="identity-copy">
          <p className="eyebrow">{isIslandView ? "Opposing forces · Island base" : "Arleigh Burke class · DDG 96"}</p>
          <h1>{isIslandView ? "North Watch" : "Destroyer Sea Trial"}</h1>
        </div>
        <div className="renderer-status" role="status" aria-live="polite">
          <span className={`status-indicator status-${status.state}`} />
          {status.state === "loading" && "Preparing sea"}
          {status.state === "ready" && status.backend}
          {status.state === "error" && "Renderer error"}
        </div>
      </header>

      <nav className="nav-actions" aria-label="World navigation">
        {isIslandView ? <button
          type="button"
          className="camera-toggle hud-panel"
          disabled={status.state !== "ready"}
          onClick={() => sessionRef.current?.resetIslandView()}
          title="Center the island and restore its overview"
        >
          <span aria-hidden="true">↺</span>
          Reset island view
        </button> : <button
          type="button"
          className="camera-toggle hud-panel"
          aria-pressed={cameraView !== "chase"}
          disabled={status.state !== "ready"}
          onClick={toggleCameraView}
        >
          <span aria-hidden="true">{cameraView !== "chase" ? "◉" : "◎"}</span>
          {cameraView !== "chase" ? "Return to chase view" : "Forward gun view"}
        </button>}
        <button
          type="button"
          className="island-view-button hud-panel"
          aria-pressed={isIslandView}
          disabled={status.state !== "ready"}
          onClick={() => {
            if (isIslandView) sessionRef.current?.setCameraView("chase");
            else sessionRef.current?.viewIsland();
          }}
          title={isIslandView ? "Resume the destroyer's camera and controls" : "Control the North Watch island camera"}
        >
          <span aria-hidden="true">⌖</span>
          {isIslandView ? "Return to ship" : "View island"}
        </button>
      </nav>

      {isIslandView ? <section className="island-panel hud-panel" aria-label="North Watch island base">
        <div className="panel-title">
          <span className="eyebrow">Opponent base</span>
          <span className="base-control-status"><span aria-hidden="true" />Camera active</span>
        </div>
        <h2>North Watch</h2>
        <p className="island-description">Cliff-lined headlands surrounding a sheltered turquoise lagoon.</p>
        <div className="island-facts">
          <div><span className="metric-label">Terrain</span><strong>Rocky highlands</strong></div>
          <div><span className="metric-label">Coast</span><strong>Sheltered lagoon</strong></div>
        </div>
        <p className="island-camera-note">Independent island camera</p>
      </section> : <section className="speed-panel hud-panel" aria-label="Destroyer instrumentation">
        <div className="speed-reading">
          <span className="metric-label">Speed</span>
          <div>
            <strong>{telemetry.speedKnots.toFixed(1)}</strong>
            <span className="speed-unit">kn</span>
          </div>
        </div>
        <div className="nav-readings">
          <div>
            <span className="metric-label">Heading</span>
            <strong>{heading}°</strong>
          </div>
          <div>
            <span className="metric-label">Throttle</span>
            <strong>{Math.round(telemetry.throttlePercent)}%</strong>
          </div>
        </div>
        <div className="throttle-track" aria-label={`Throttle ${Math.round(telemetry.throttlePercent)} percent`}>
          <span style={{ width: `${Math.min(100, Math.abs(telemetry.throttlePercent))}%`, background: telemetry.throttlePercent < 0 ? "#eeac75" : undefined }} />
        </div>
        <div className="voyage-reading"><span>Log {(telemetry.distanceMeters / 1852).toFixed(2)} nm</span><span>Rudder {Math.abs(telemetry.rudderDegrees).toFixed(0)}°{Math.abs(telemetry.rudderDegrees) < .5 ? "" : telemetry.rudderDegrees < 0 ? " P" : " S"}</span></div>
      </section>}

      <aside className="performance-panel hud-panel" aria-label="Development performance metrics">
        <div className="panel-title">
          <span className="eyebrow">Sea conditions · Fair</span>
          <span className="live-dot" />
        </div>
        <div className="performance-grid">
          <Metric label="FPS" value={String(telemetry.fps)} />
          <Metric label="Frame" value={`${telemetry.frameTimeMs.toFixed(1)} ms`} />
          <Metric label="Meshes" value={String(telemetry.activeMeshes)} />
          <Metric label="Gulls" value={String(telemetry.activeBirds)} />
          <Metric label="Sim step" value={`${telemetry.simulationTimeMs.toFixed(3)} ms`} />
          <label className="quality-setting">
            <span className="metric-label">Quality</span>
            <select value={quality} onChange={(event) => updateQuality(event.currentTarget.value)}>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </label>
        </div>
        <div className="sound-controls">
          <button type="button" aria-pressed={telemetry.soundStatus === "on"}
            disabled={status.state !== "ready"}
            onClick={() => { void sessionRef.current?.audio.setEnabled(sessionRef.current?.audio.status !== "on"); }}>
            <span aria-hidden="true">{telemetry.soundStatus === "on" ? "♪" : "♫"}</span>
            {telemetry.soundStatus === "on" ? "Sound on" : telemetry.soundStatus === "muted" ? "Sound muted" : telemetry.soundStatus === "unavailable" ? "Retry audio" : telemetry.soundStatus === "blocked" ? "Resume sound" : "Enable sound"}
          </button>
          <label title="Master volume">
            <span className="sr-only">Master volume</span>
            <input aria-label="Master volume" type="range" min="0" max="100" value={volume}
              onChange={event => {
                const next = Number(event.currentTarget.value);
                setVolume(next);
                sessionRef.current?.audio.setVolume(next / 100);
                if (next > 0) void sessionRef.current?.audio.setEnabled(true);
              }} />
          </label>
        </div>
      </aside>

      {!isIslandView && <section className="missile-panel hud-panel" aria-label="Cruise missile launchers">
        <div className="panel-title">
          <span className="eyebrow">Cruise missiles</span>
          <span className={`missile-readiness${missileCoolingDown ? " is-cooling" : ""}`}>
            {status.state !== "ready" ? "Standby" : missileCoolingDown ? `${telemetry.missiles.cooldownSeconds.toFixed(1)}s` : "Ready"}
          </span>
        </div>
        <div className="missile-launchers">
          <button type="button" className="missile-launch-button"
            disabled={status.state !== "ready" || missileCoolingDown || telemetry.missiles.forwardRemaining === 0}
            onClick={() => sessionRef.current?.launchMissile("forward")}>
            <span><strong>Launch forward</strong><small>{telemetry.missiles.forwardRemaining} / 32 missiles</small></span>
            <kbd>R</kbd>
          </button>
          <button type="button" className="missile-launch-button"
            disabled={status.state !== "ready" || missileCoolingDown || telemetry.missiles.aftRemaining === 0}
            onClick={() => sessionRef.current?.launchMissile("aft")}>
            <span><strong>Launch aft</strong><small>{telemetry.missiles.aftRemaining} / 64 missiles</small></span>
            <kbd>T</kbd>
          </button>
        </div>
        <div className="missile-flight-status">
          <span role="status" aria-live="polite">{missileFlightStatus}</span>
          <span>{telemetry.missiles.activeMissiles > 0 ? `${telemetry.missiles.activeMissiles} airborne` : ""}</span>
          <button type="button" className="missile-track-button"
            aria-pressed={cameraView === "missile"}
            disabled={status.state !== "ready" || (cameraView !== "missile" && telemetry.missiles.activeMissiles === 0)}
            onClick={toggleMissileTracking}>
            {cameraView === "missile" ? "Stop tracking" : "Track launch"}
          </button>
        </div>
      </section>}

      <footer className="control-panel hud-panel">
        {isIslandView ? <>
          <div className="control-hint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Pan</span></div>
          <div className="control-hint"><kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd><span>Pan</span></div>
          <span className="hint-divider" />
          <span className="mouse-hint island-mouse-hint">Drag to orbit · Scroll to zoom · Right-drag to pan</span>
        </> : <>
        <div className="control-hint"><kbd>W</kbd><span>Throttle</span></div>
        <div className="control-hint"><kbd>S</kbd><span>Astern / brake</span></div>
        <div className="control-hint"><kbd>A</kbd><kbd>D</kbd><span>Rudder</span></div>
        {cameraView === "forward" && <div className="control-hint"><kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd><span>Aim gun</span></div>}
        {cameraView === "forward" && <div className="control-hint"><kbd>Space</kbd><span>Fire</span></div>}
        <div className="control-hint"><kbd>H</kbd><span>Ship horn</span></div>
        <span className="hint-divider" />
        <span className="mouse-hint">
          {cameraView === "missile" ? "Following latest missile" : cameraView === "chase" ? "Drag to look · Scroll to zoom" : "↑ / ↓ elevation · ← / → traverse · Space fire"} · Click or steer to start audio
        </span>
        </>}
      </footer>

      {status.state === "error" && (
        <div className="error-message" role="alert">
          {status.message}
        </div>
      )}
    </main>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="performance-metric">
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function isGraphicsQuality(value: string): value is GraphicsQuality {
  return value === "High" || value === "Medium" || value === "Low";
}
