# Naval Combat

A browser-based naval game prototype built with a Babylon.js client, standalone Node.js server, and shared TypeScript simulation package. Phase 1 is a single-player open-water sea trial with ship handling and weapon firing visuals. Target engagement and multiplayer remain outside the current prototype.

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

Click **View island** to control the North Watch opponent-base camera. Drag to orbit, scroll to zoom, right-drag to pan, or use **WASD / arrow keys** to move the view across the island. **Reset island view** restores the overview; **Return to ship** restores ship control. Switching views preserves the ship's position and momentum, clears held controls, and disables ship weapons while inspecting the base. The ship continues to coast in the background. North Watch is a compact, elongated island with low cliff-lined headlands, two broad rocky highlands, scattered tropical vegetation, and a deep turquoise lagoon edged with a narrow sandy shore and reef breakers. A small lagoon pier connects to the naval outpost. The full hull collides with land and the pier, including during turns and reverse travel; the open lagoon remains navigable. Multiplayer and base combat remain future work.

**Click the sea or press a movement key to start sound**, or click **Enable sound**. The soundscape includes turbine hum, engine harmonics, propeller wash, wind, water, and recorded herring-gull calls. Calls follow nearby passing birds in space, with distance fading and a subtle pitch change as they approach and recede. Press **H** for a two-tone ship horn. Master volume starts at 75%; the sound button mutes the entire mix and stays muted until explicitly enabled. Moving the volume slider above zero enables sound. Audio pauses while the tab is hidden and resumes when returning; a **Resume sound** button appears if the browser still blocks playback. Sea, machinery and horn sounds are synthesized. The gulls use a CC0 recording, and the forward gun uses a real U.S. Navy Mk 45 discharge recorded aboard USS Dewey; [audio sources and attribution](client/public/audio/README.md).

Click **Forward gun view**, use the arrow keys to train and elevate the Mk 45, and press **Space** to fire. Shots have a 3.2-second loading interval, a brief muzzle flash, fast recoil with a slower return, and a pale propellant plume that expands, slows and drifts in the wind independently of the vessel. Conventional shells do not leave a glowing projectile trail. The firing cadence follows the Navy's published [Mk 45 rate of 16–20 rounds per minute](https://www.navy.mil/DesktopModules/ArticleCS/Print.aspx?Article=2167864&ModuleId=724&PortalId=1). Smoke motion and the existing short-range practice trajectory remain visual approximations.

Press **R** to launch a cruise missile from the forward Mk 41 bank, or **T** from the rear bank near the middle deck; the HUD also has a launch button for each bank. The demonstration loadout provides 32 forward and 64 rear launches, with a 3.5-second gameplay interval between shots. These counters represent the visual demo's available cells rather than a real ship's ammunition mix. A cell hatch opens before the missile rises from inside the deck with bright rocket fire and a billowing exhaust cloud. It climbs vertically, pitches into a smooth outbound curve, deploys its wings, sheds the booster and continues into the distance. Smoke expands, fades and drifts in world space after the ship moves away. After the rocket motor stops, the dense launch trail dissipates; faint cruise exhaust remains as a visual cue. Click **Track launch** to follow an airborne missile; the camera automatically returns to the ship when the flight expires. Flights have a bounded 30-second lifetime, with spent visuals cleaned up automatically.

The broad vertical-booster-to-cruise sequence follows public accounts of the [NAVAIR Stethem launch](https://www.navair.navy.mil/node/5796) and [NAVAIR Churchill launch](https://www.navair.navy.mil/node/9031), with [official U.S. Navy Arleigh Burke launch footage](https://www.dvidshub.net/video/362164/uss-arleigh-burke-tomahawk-launches) as a visual reference. Missile forces, altitudes, steering, stage timings and launch cadence are artistic game values; the effect approximates the visible sequence without modeling real weapon operation or targeting.

The client tries WebGPU first and falls back to WebGL 2. The server can still run independently in another terminal with `npm run dev:server`; it currently exposes only `GET /health` at `http://127.0.0.1:2567` by default. Set `HOST` or `PORT` to change its address. The server scripts load an optional `server/.env` using Node's built-in environment-file support.

## Build and check

```sh
npm run check
npm test
```

`npm run check` type-checks the workspaces and builds the client and server. `npm run build` creates production assets in `client/dist` and compiled server files in `server/dist`.

## Project layout

- `client/` — React HUD, Babylon renderer, open-water scene, boat visuals, wake, sky and animated seabirds.
- `server/` — standalone Node.js HTTP process, ready to grow into the authoritative game server.
- `shared/` — renderer-independent boat movement, visual cruise-missile flight and analytical ocean wave queries shared by the client and future server simulation.
- `docs/architecture.md` — simulation/rendering boundaries and decisions for future ship classes.

The sea combines six directional swell/wind waves with gravity-derived speeds and second-order crest shaping. The boat simulation uses a fixed 60 Hz step and 21 weighted waterplane probes over that same wave field. Added heave mass and damping relative to the moving water drive heavy-vessel heave, pitch and roll; the visual water clock follows the interpolated hull. These are fair-weather, deep-water approximations, with artistic coastal surf rather than a full fluid or measured ship-response simulation.

Fine wind ripples use a cached, mipmapped 256-pixel slope texture, with sky reflections from the existing one-time cubemap and view-dependent seawater reflectance. Stitched camera-centred mesh rings concentrate geometry near the viewer and filter unresolved waves at the horizon. High/Medium/Low use about 117k/52k/29k water triangles, 35–46% fewer than the previous mesh. Foam follows waves on the GPU; history buffers remain bounded and update at 30 Hz, avoiding thousands of CPU height queries and repeated geometry or texture generation during play.

The daytime sky uses blue atmospheric scattering, horizon haze, a correctly sized solar disc and soft glare. Sparse clouds drift through a cached, mipmapped density and lighting texture; quality scales texture lookups without adding cloud meshes or recurring reflection passes. The default chase view includes the horizon. Gulls have shaped bodies, heads, eyes, bills, tails and articulated feathered wings. Their world-anchored flybys alternate gliding with short bursts of wingbeats and use three shared instanced meshes. Short recorded calls follow the visible birds through two reusable spatial audio voices; missing recordings have a cached synthesized fallback.

The detailed destroyer follows the supplied overhead and broadside photo references: a raked stem and flared bow, chamfered Aegis deckhouse with octagonal array faces, separated uptake groups, closed twin hangars, a secured Seahawk with its main rotor spread, anchor chains, liferafts, RHIBs, antenna platforms, deck hatches and ventilation. Static fittings are merged by material; rudders and twin five-blade propellers remain animated.

The hull and upperworks follow the supplied bow, broadside and quarter views while retaining a consistent Flight IIA layout and DDG 96 identity. Closely spaced, smoothly interpolated hull stations form the flared bow, rising sheer and raked stem. The bridge carries pale octagonal array faces and distinct roof sensors; separate uptake houses have raised, flanged black exhaust sleeves. An open tripod supports two narrow signal yards, galleries, ladders and fine halyards. Detailed RHIBs sit on steel cradles under hydraulic davits, with service pipework, valves and cabinets in the open boat bay. Matte gray paint includes restrained welds, repainted plates and runoff, with boot topping at the waterline. The photographs show different hull variants, so this remains a coherent procedural interpretation of their visible features.

The aft flight deck follows the hull's sheer and tapered stern, with weathered nonskid, a landing circle and crossing alignment marks, flush tie-down sockets, recovery/traverse rails, inset green edge lights, lowered mesh safety nets and aviation fire equipment beside the twin hangars. The secured Seahawk has a shaped cabin, cockpit glazing, engine inlets/exhausts, sensor turrets, landing gear, wheel chocks, deck securing chains and an extended four-blade rotor. Its approximate 16.4 m rotor span follows the [U.S. Navy Seahawk fact file](https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2166650/mh-60-seahawk-helicopter/); the deck arrangement follows the supplied aft-quarter image and is a visual approximation.


Handling uses stern rudder lift, rotational inertia, hydrodynamic yaw damping, surge/sway added mass and drag. Momentum stays in world coordinates as the hull turns, so the vessel develops sideslip and loses speed under hard helm. Distributed waterplane sampling drives damped heave, pitch and roll. Coefficients approximate heavy-vessel handling rather than certified ship performance. The voyage log reports real distance travelled in nautical miles; there is no movement time scaling. Clouds remain in world space, and approximately 50 seconds of foam history remains on the actual path through a turn.
