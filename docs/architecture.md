# Architecture notes

The project separates browser presentation, rendering, simulation, and server process without creating placeholders for deferred game systems.

## Current boundaries

- `client/src/engine` owns WebGPU-first renderer selection and the WebGL 2 fallback.
- `client/src/ui` mounts the canvas, reports renderer state, and presents the instrumentation HUD. Babylon owns the 3D scene and render loop.
- `client/src/game` connects keyboard intent, fixed-step simulation, rendering, quality settings, and HUD telemetry.
- `client/src/ships` turns interpolated simulation state into a procedural Arleigh Burke–class Flight IIA destroyer.
- `client/src/world` owns the shader ocean, sky and lighting, wake geometry, and lightweight cloud/bird sprites.
- `shared/src/simulation` contains renderer-independent boat motion. It models thrust, drag, lateral damping, yaw response, buoyancy, pitch, and roll without depending on Babylon.js.
- `shared/src/oceanWaves.ts` defines the analytical wave field used by both shared buoyancy queries and the client water shader.
- `client/src/physics` remains the Havok initialization boundary for future general collisions. The prototype's ship motion stays purpose-built rather than being forced into a generic rigid body.
- `server/src` is an independent Node.js process. Its health endpoint proves the process can start; there is no multiplayer protocol or game authority yet.

## Simulation and rendering flow

The client samples W/S/A/D (or arrow keys) into normalized throttle and steering intent. `BoatSimulation` advances at a fixed 60 Hz and keeps previous/current state for interpolation. It preserves world-space momentum during turns; lateral drag brings the velocity around to the new heading. Rudder authority scales with signed forward speed, so a stopped ship cannot pivot and astern steering reverses. Propulsion, rudder travel, and yaw have separate slow response times. The renderer consumes that state to move the boat, wake, ocean origin, smoothed camera target, and distant ambience. Because wave parameters are shared, the hull probes sample the same moving wave field displayed by the shader.

Simulation state uses meters, seconds, radians, and kilograms, with +Y up and +Z as the boat's forward axis. Future ship classes can share the intent/state boundary while providing different force, hull-probe, and steering configuration. This keeps render objects out of server simulation and leaves room to specialize patrol boats, larger surface ships, and submarines.

## Performance decisions

- The ocean is one player-following 7.6 km square patch. A cubic distribution places small grid cells around the hull and progressively larger cells near the horizon. It snaps in 1 m increments, with distance haze softening its edge.
- Large waves are evaluated analytically in the vertex shader; only four water samples per fixed simulation step are evaluated on the CPU for buoyancy.
- High/Medium/Low adjust water subdivisions and detail, sprite counts, shadow-map size, render scaling, and camera range.
- Ambient clouds and birds share one generated sprite sheet and one sprite manager. Two pooled gull flocks have staggered flybys; each pass is anchored in world space. Wake ribbons reuse typed arrays and a small generated foam texture.
- The blue daytime sky and water have native WGSL/GLSL shaders. A 64-pixel cubemap captures only the sky once for boat materials. The sky does not write depth, so distant clouds remain visible.
- Static destroyer details are merged by material; the rotating search radar retains its own transform. Camera distances, shadow coverage, and the wake use the full-size 155 m hull scale.
- `MaritimeAudio` creates a small Web Audio graph on user interaction. Looping filtered noise supplies sea/wind, turbine and engine harmonics plus propeller noise track throttle/speed, short gull envelopes accompany passing birds, and H triggers a two-tone ship whistle. First sea clicks or movement keys resume audio, while explicit mute persists. Status follows the AudioContext state. Sources are reused or disconnected after playback; the context is suspended when hidden and closed on disposal.
- Optional Babylon shader passes are registered before rendering, avoiding missing `.fx` requests during development. Quality changes retain WebGPU and WebGL parity.
- No combat systems, persistence, or multiplayer protocol are implemented in Phase 1.
