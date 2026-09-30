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
};

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<GameSession | undefined>(undefined);
  const [status, setStatus] = useState<GameStatus>({ state: "loading" });
  const [telemetry, setTelemetry] = useState<GameTelemetry>(EMPTY_TELEMETRY);
  const [quality, setQuality] = useState<GraphicsQuality>(DEFAULT_GRAPHICS_QUALITY);
  const [volume, setVolume] = useState(75);
  const [cameraView, setCameraView] = useState<"chase" | "forward">("chase");

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
        session.setCameraView(cameraView);
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
        session?.dispose();
        renderer?.engine.dispose();
        if (disposed) return;
        const message = error instanceof Error ? error.message : "Unknown initialization error";
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
    setCameraView(next);
  };

  const heading = String(Math.round(telemetry.headingDegrees) % 360).padStart(3, "0");

  return (
    <main className="game-shell">
      <canvas ref={canvasRef} className="render-canvas" aria-label="Third-person naval sea trial" />

      <header className="identity-panel hud-panel">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="identity-copy">
          <p className="eyebrow">Arleigh Burke class · DDG 96</p>
          <h1>Destroyer Sea Trial</h1>
        </div>
        <div className="renderer-status" role="status" aria-live="polite">
          <span className={`status-indicator status-${status.state}`} />
          {status.state === "loading" && "Preparing sea"}
          {status.state === "ready" && status.backend}
          {status.state === "error" && "Renderer error"}
        </div>
      </header>

      <button
        type="button"
        className="camera-toggle hud-panel"
        aria-pressed={cameraView === "forward"}
        disabled={status.state !== "ready"}
        onClick={toggleCameraView}
      >
        <span aria-hidden="true">{cameraView === "forward" ? "◉" : "◎"}</span>
        {cameraView === "forward" ? "Return to chase view" : "Forward gun view"}
      </button>

      <section className="speed-panel hud-panel" aria-label="Destroyer instrumentation">
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
      </section>

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

      <footer className="control-panel hud-panel">
        <div className="control-hint"><kbd>W</kbd><span>Throttle</span></div>
        <div className="control-hint"><kbd>S</kbd><span>Astern / brake</span></div>
        <div className="control-hint"><kbd>A</kbd><kbd>D</kbd><span>Rudder</span></div>
        <div className="control-hint"><kbd>H</kbd><span>Ship horn</span></div>
        <span className="hint-divider" />
        <span className="mouse-hint">
          {cameraView === "chase" ? "Drag to look · Scroll to zoom" : "Looking ahead from behind the main gun"} · Click or steer to start audio
        </span>
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
