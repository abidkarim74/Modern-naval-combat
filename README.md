# Naval Combat

A browser-based naval game prototype built with a Babylon.js client, standalone Node.js server, and shared TypeScript simulation package. Phase 1 is a single-player open-water sea trial; combat and multiplayer are intentionally out of scope.

## Requirements

- Node.js 22.9 or newer
- npm 10 or newer

## Install and run

```sh
npm install
npm run dev:client
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). The vessel is a procedural **Arleigh Burke–class Flight IIA destroyer**, with a 155.29 m hull, 18 m beam, haze-gray superstructure, SPY-1 array faces, twin funnels, Mk 45 gun, 96 VLS hatches, twin helicopter hangars, and marked aft flight deck. DDG 96 markings identify the visual reference; geometry and handling are approximations, not a shipyard-exact model or certified naval simulator. Public dimensions and class features: [U.S. Navy destroyer fact file](https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2169871/destroyers-ddg-51/).

Hold **W** for ahead thrust, **S** for astern thrust/braking, and **A/D** for rudder; arrow keys also work. Release W/S to coast. Allow time for propulsion to build: roughly 12 knots after 30 seconds and 30 knots after three minutes. A moving destroyer keeps momentum, takes a wide turn, and slows gradually. Rudders cannot pivot it at rest, and it has no arcade sideways movement. Reverse steering changes direction. Drag to rotate the chase camera and scroll to change its distance. Use the HUD quality selector to choose High, Medium, or Low.

**Click the sea or press a movement key to start sound**, or click **Enable sound**. The soundscape includes turbine hum, engine harmonics, propeller wash, wind, water, and occasional gulls. Press **H** for a two-tone ship horn. Master volume starts at 75%; the sound button mutes the entire mix and stays muted until explicitly enabled. Moving the volume slider above zero enables sound. Audio pauses while the tab is hidden and resumes when returning; a **Resume sound** button appears if the browser still blocks playback. These are synthesized effects, not recordings of a specific destroyer.

The client tries WebGPU first and falls back to WebGL 2. The server can still run independently in another terminal with `npm run dev:server`; it currently exposes only `GET /health` at `http://127.0.0.1:2567` by default. Set `HOST` or `PORT` to change its address. The server scripts load an optional `server/.env` using Node's built-in environment-file support.

## Build and check

```sh
npm run check
npm test
```

`npm run check` type-checks the workspaces and builds the client and server. `npm run build` creates production assets in `client/dist` and compiled server files in `server/dist`.

## Project layout

- `client/` — React HUD, Babylon renderer, open-water scene, boat visuals, wake, and environmental sprites.
- `server/` — standalone Node.js HTTP process, ready to grow into the authoritative game server.
- `shared/` — renderer-independent boat movement and analytical ocean wave queries shared by the client and future server simulation.
- `docs/architecture.md` — simulation/rendering boundaries and decisions for future ship classes.

The boat simulation uses a fixed 60 Hz step and 21 weighted waterplane probes. The same wave parameters drive the shader and buoyancy samples, so rendering and motion stay in phase while simulation code remains independent of Babylon.js.

The detailed destroyer follows the supplied overhead and broadside photo references: a raked stem and flared bow, chamfered Aegis deckhouse with octagonal array faces, separated uptake groups, closed twin hangars, a folded-rotor Seahawk, anchor chains, liferafts, RHIBs, antenna platforms, deck hatches and ventilation. Static fittings are merged by material; rudders and twin five-blade propellers remain animated.

Handling uses stern rudder lift, rotational inertia, hydrodynamic yaw damping, surge/sway added mass and drag. Momentum stays in world coordinates as the hull turns, so the vessel develops sideslip and loses speed under hard helm. Distributed waterplane sampling drives damped heave, pitch and roll. Coefficients approximate heavy-vessel handling rather than certified ship performance. The voyage log reports real distance travelled in nautical miles; there is no movement time scaling. Clouds remain in world space, and approximately 50 seconds of foam history remains on the actual path through a turn.
