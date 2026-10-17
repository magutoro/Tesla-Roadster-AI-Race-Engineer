# Tesla Roadster + AI Race Engineer

**Tesla just revealed a car that can stick to the road with fans and fly with thrusters. Nobody knows how to drive it. This is a browser simulator for it, and your phone is the steering wheel.**

Hold your phone sideways and tilt it to steer. Use the on-screen buttons for gas, brake, fan suction and the cold-gas thrusters. Like the real reveal car:
- the fans pull with 2 g, so you can corner at about 3 g or **drive upside down** on the curl ramp;
- 4 rear thrusters (**BOOST**) push with 80 kN from a compressed-air tank;
- 4 corner thrusters (**LIFT**) let you hop and hover;
- one tap of **ROLL** does an automatic **mid-air barrel roll** that lands upright.

An AI coach connects live driving state to **ai& Inference**, with spoken tips, English/Japanese feedback and driver questions. See [coach setup and integration](docs/coach-integration.md).

The engineer starts **off** to avoid API spending. Turning it on enables spoken AI coaching and attempts hands-free conversation. A free voice selector and preview use installed Mac/browser voices without speech API costs.

> Built at the Tokyo Agent Hackathon (+81 Builders), Oct 17 2026.
> The car is an **original stylized model inspired by the Tesla Roadster**. This project is **not affiliated with Tesla**, and it uses no Tesla assets, logos or 3D models. Physics numbers are based on Tesla's claims at the Oct 15, 2026 reveal, as reported in the press (2 g fan suction, 10 thrusters, over 80 kN, 200 L / 600 L air tanks, 0–60 mph under 0.59 s for the Rocket trim). They are presented as claims, not verified facts.

## Status: prototype

| Works | Not built yet |
|---|---|
| Driving, fans (incl. upside down), BOOST, LIFT, barrel ROLL, soft landing, 3 trims | |
| Phone yoke over HTTPS tunnel (tilt upright or flat, drag fallback) | AI scenario generator (Milestone 6) |
| 7 levels: Blank, Reveal Curl, Reveal Jump, **Suzuka (real layout)**, Figure-8 Circuit, Warehouse Parking, Rush-Hour Expressway | |
| Speed-adaptive racing line, telemetry, sound, title screen, guided demo | |
| Live ai& engineer, EN/JA tips, optional speech, typed/voice questions | Local Whisper transcription |

## Setup

You need Node.js 20.12 or newer.

```
npm install
npm start
```

Open http://localhost:3000 on the laptop. Keyboard controls work right away.

### Phone setup (iPhone)

iPhones only share tilt data with **HTTPS** pages, so the server opens a temporary public HTTPS address (a "tunnel") for the laptop.

1. Install a tunnel tool (one is enough):
   - **cloudflared** (preferred, no account): `brew install cloudflared`, or download `cloudflared-darwin-arm64.tgz` from https://github.com/cloudflare/cloudflared/releases and put the `cloudflared` file somewhere on your PATH.
   - **ngrok** (backup, needs a free account): https://ngrok.com/download, then `ngrok config add-authtoken <your-token>`.
2. Start the server with the tunnel:
   ```
   npm run phone
   ```
   It tries cloudflared first. If that doesn't connect within 20 s (some Wi-Fi networks block it), it switches to ngrok. To go straight to ngrok, use `npm run phone:ngrok`.
3. Open http://localhost:3000 on the laptop. The QR code at the bottom left now shows the HTTPS phone link (it's also printed in the terminal).
4. Scan it with the iPhone camera. If ngrok shows a warning page, tap **Visit Site**.
5. On the phone, turn on **Portrait Orientation Lock** so steering cannot rotate the display. Tap **Tap to start**, then **Allow** for motion access. Hold the phone sideways; the controller supplies its own landscape view even with the OS locked in portrait. Tap **FLIP VIEW** if it looks upside down.
6. Hold the phone the way you want "straight ahead" to feel and tap **CENTER**.

The tunnel address changes each time you restart `npm run phone`, so rescan the QR code after a restart.

## Controls

| Action | Phone | Keyboard |
|---|---|---|
| Steer | Tilt the phone left/right (upright or flat), or drag the yoke | A / D (or ← / →) |
| Gas / brake + reverse | GAS / BRAKE (hold) | W / S |
| Fans on/off | FANS | F |
| Rear thrusters | BOOST (hold) | Space |
| Lift: hop / hover (Rocket) | LIFT (hold), tip the phone forward/back to lean | Shift, ↑ / ↓ to lean |
| Barrel roll (Rocket) | ROLL (tap, rolls toward the side you're steering) | Q (left) / E (right) |
| Trim | MODE | 1 / 2 / 3 |
| Reset car | RESET | R |
| Camera (chase / cockpit / overhead) | | C |
| Racing line on/off (Suzuka, Figure-8) | | G |
| Next level | | L |
| Recenter steering | CENTER | |
| Telemetry panel | | T |
| Sound on/off | | M |
| Presentation mode (clean screen) | | P |
| Menu / guided demo: next scene | | Esc / N |

Trims, as in the reveal: **Performance** (fans only, top speed 210 mph / 338 km/h), **Thrust** (fans + 4 rear thrusters, 200 L of air, 230 mph / 370 km/h), **Rocket** (all 10 thrusters, 600 L of air, 233 mph / 375 km/h; this is the default). In Rocket mode, steering while airborne fires the front yaw thrusters, and the corner thrusters soften hard landings by themselves.

**Scenarios:**
- **Suzuka Circuit (real layout):** the real 5.8 km track, built from OpenStreetMap with real elevation (about 40 m from the lowest to the highest point), the figure-8 crossover bridge, grandstands, pit lane, gravel traps and guardrails. The **racing line adapts to your speed**: green = go, yellow = lift, red = brake now (it knows your fans add grip). Press G to hide it.
- **Figure-8 Circuit (Suzuka-style):** set a lap time through 12 green gates. The track crosses over itself on a bridge. Grass is slippery and gravel traps slow you down hard.
- **Warehouse Store Parking (Costco-style):** the lot is full except one spot, and a purple SUV is heading for it. Park first, lined up and stopped, or fly over the rows.
- **Rush-Hour Expressway:** dense traffic that drives on the left like in Japan, and an accident blocking every lane at 1.3 km. Reach the exit in 80 s. Hint: LIFT and lean forward.

**Try the reveal stunt:** pick **Reveal Curl**, press FANS, drive up the curl at about 50–60 km/h, and tap ROLL as you come off the top upside down.

The phone shows **tilt OK** (green) when motion data is arriving. If it says **tilt: no data**, reload the page, tap Start, then tap **Allow**. Meanwhile you can steer by dragging the yoke.

## For the demo

- The game opens on a **title screen** with the phone QR code and the car turning in a showroom. **Guided demo** runs four scenes (the curl stunt, the parking lot, the highway jam, a circuit lap) with hints that react to what you're doing. Press N to skip a scene, Esc for the menu.
- **P** hides the help panels for the projector. **T** opens the telemetry panel (G-G plot, all four tires, traces, thrusters).
- Sound is generated live (motor, wind, tire squeal, fans, thrusters). Press M to mute.

## How it looks

- **Sky and light:** a physically based sky with clouds, a sun that matches it, reflections taken from the same sky, and distance haze (`environment.js`).
- **Surfaces:** photo textures for asphalt, grass, concrete and gravel, sized in real meters (`materials.js`).
- **Circuits** (`trackside.js`): curbs only in corners, gravel traps on the outside of corners, steel guardrails, pit lane and pit wall, grandstands with a crowd, woods, and hills on the horizon.
- **Suzuka:** the layout comes from OpenStreetMap and the heights from NASA satellite data. `node tools/build-suzuka.mjs` rebuilds `levels/suzuka.json` (the downloaded map data is cached in `tools/data/`). We build the 3D track ourselves from this data instead of using a downloaded 3D model of the real circuit, because those models are copyrighted.

## How it works

- `server.js` is an Express server plus a WebSocket relay. The phone sends its controls about 30× per second, and the server passes them to the game screen. Measured phone → tunnel → server → game latency: about 20 ms.
- The game uses three.js for graphics and Rapier for physics (120 Hz). Rapier does the suspension, and our own tire model does the grip: a "magic formula" tire with load sensitivity and a friction circle, plus a 1 MW power-limited powertrain with regen, TC/ABS/ESC, anti-roll bars, aero drag and downforce, and fan suction. The thrusters use real air mass and pressure numbers. Everything feeds the telemetry panel.
- All tunable numbers are in `public/config.js`. All message formats are in `public/shared/protocol.js`.
- Libraries are served straight from `node_modules` with an import map, so there's no build step.

## How we use ai& (sponsor tool)

1. **AI coach:** the game sends a short car-state summary periodically. ai& returns concise coaching in English or Japanese. Enable Voice on for speech on straights, hold V to ask a question in supported browsers, or type in the engineer panel. Missing credentials or API failure use clearly labeled practice tips. `/coach-lab.html` provides sample inputs. Live browser telemetry now supplies measured lap/corner summaries through the pipeline documented in [coach integration](docs/coach-integration.md).
2. **Scenario generator (planned):** describe a situation and have the model return a validated level JSON.

Put `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL` in `.env` (copy `.env.example`). The key stays on the server.

## Add a level

1. Copy `levels/blank.json` to `levels/my-level.json` and edit it. Positions are in meters, and `heading` is in degrees (0 = +Z, 90 = +X).
   - Prop types: `box`, `wall`, `ramp`, `curl` (bends up and over until upside down), `cone`, `checkpoint`, `parking_spot`, `paint` (flat color, no collision), `grandstand`.
   - Generator props that build a whole scene: `track`, `parking_lot`, `highway` (see `levels/circuit.json`, `levels/suzuka.json`, `levels/warehouse-parking.json`, `levels/expressway.json` and the notes in `CLAUDE.md`).
   - Goals: `reach` (optional `timeLimit`), `lap`, `park`.
   - Car kinds: `compact`, `sedan`, `suv`, `pickup`, `van`, `semi` (behavior `parked` for now).
   - Goal: `{ "type": "reach", "x", "z", "radius", "text" }`.
2. Add it to `levels/index.json`.
3. Pick it from the level menu, or open http://localhost:3000/game.html?level=my-level.

## Credits

- Suzuka track layout: © OpenStreetMap contributors, available under the Open Database License (ODbL), https://www.openstreetmap.org/copyright
- Elevation: NASA SRTM (30 m), fetched through the OpenTopoData API.
- Textures (asphalt, grass, concrete, gravel): Poly Haven (polyhaven.com), CC0.
- Libraries: three.js, Rapier, Express, ws, qrcode.

## Repository privacy

This repository starts private. It is an independently maintained copy of a collaborative prototype; earlier contributor identities and Git history are omitted for privacy. Third-party asset and data credits are preserved. Keep credentials and local driving recordings out of Git.

### Optional Neo4j race memory

The engineer can remember lap summaries and corner measurements across sessions using Neo4j Aura Free. See [setup and integration](docs/neo4j-memory.md). Run `npm run memory:check` to verify the connection without AI charges, or use the practice page to load isolated examples. The game still runs without Neo4j.

The memory now links one repeated measured issue to a bounded coaching cue and the next comparable attempt's outcome. Try the free loop on `/coach-lab.html`, or run `npm run memory:loop-demo` to verify it in Aura. Actual circuit driving now produces structured analysis with matching comparison metadata and driving timestamps; examples and replays stay in the separate demo dataset.

### Camera views

In Free drive, use **Camera view** in the upper-right panel to choose Chase, Cockpit, Overhead or the existing Showroom orbit. **C** cycles the same views. Your selection is remembered in this browser; returning to the title screen temporarily uses the showroom camera and restores your selected driving view when you resume.

### Goal-based engineer practice

Tell the engineer “I want to work on corner speed at T4”, or choose a Practice goal. It selects one measured experiment and shows the supporting lap count, speed/offset differences and time loss. Measured focus cards and evidence lookup use no AI credits; typed/spoken goals and optional automatic AI explanations use ai&. Exact seconds-based braking cues require the optional measured braking-time offset from analysis. Try **Load local goal examples** on `/coach-lab.html` for a labeled demonstration; real driving supplies corner-analysis events after clean circuit laps.


## Live telemetry, lap analysis, and replay (milestones 1–2)

On **Figure-8** or **Suzuka**, open **Driving data · 10 Hz** below the speed display. Telemetry records automatically while the game page is active, independently of engineer power and AI credits. Samples include speed, pedals, steering, lap time/number, normalized track position, lateral/longitudinal g, fan/trim settings, and all four simulated tire temperatures. This electric simulator has no engine gearbox/RPM; those CSV columns are blank, not invented.

1. Finish the out-lap and cross the start/finish line. The analysis start line is the actual track line; its timing can differ slightly from the existing HUD's proximity-gate timer.
2. Keep the same trim and fan setting and complete a clean lap. This learns a fixed T1/T2… corner map from steering/lateral-g runs and records your first reference.
3. Further clean laps compare braking position, minimum speed, throttle pickup and corner duration with the best valid lap available **when that attempt began**. A new best becomes the next lap's immutable reference. Repeated issues need two comparisons against the same reference (usually three clean laps total).
4. Turn the engineer on and choose a practice goal. Every completed measured lap triggers a free plan update, including the Overall driving goal. Follow-up questions and optional automatic AI explanations use ai&; voice uses free installed voices. The graph stores compact comparisons and evaluates later attempts.

Off-track, airborne, impact, reverse, teleport, telemetry-gap/pause, or changed fan/trim laps are discarded as references. **ABS active** and **traction control active** callouts report actual simulator flags; they do not claim confirmed wheel lockup/wheelspin. Temperature callouts describe this simulator's simplified tire model.

Raw samples append in bounded asynchronous batches to ignored `logs/<track>_roadster_<session>.csv`. Failed writes retry while the page remains open, and duplicate sequences are not appended again. The last hour of samples is also available from **Download telemetry CSV** (current session only). Close/reload can lose unflushed browser samples; download before ending a session. Learned corner maps are saved in ignored `tracks/<track>_<geometry-version>_<analysis-version>.json` and reused from disk/browser cache. Analysis continues if logging/storage is unavailable.

Open [/race-replay.html](http://localhost:3100/race-replay.html), select a downloaded CSV, and click Play. It runs at real speed through the same `LapAnalyzer`, engineer, graph and voice path. Pause stops playback speech. Replay uses a separate demo memory namespace and starts with AI/voice off; enable the engineer for free measured plans. The provided `fixtures/race-session.csv` is **synthetic test data**, not a real or optimal driving lap. Regenerate it with `node tools/race-fixture.mjs`. Replay does not move the 3D car. Reset starts a new recording/reference session; the HUD may retain its separate best time. For a fast terminal check, run `npm run race:replay -- fixtures/race-session.csv` (no AI calls). Imported faster-driver reference laps are outside the current browser implementation.

Architecture: `game.js → race-session.js → shared/race-telemetry.js + shared/lap-analysis.js → race:lap-summary → coach.js → server/memory.js + server/ai.js → voice.js`. CSV replay enters the same analysis seam from `race-replay.js`. Raw telemetry never enters the language-model prompt; only compact validated car state and lap comparisons do.


Voice conversation: click **Talk to engineer**, speak one question, then pause; supported browsers submit when the utterance ends. Hold **V** and release to send manually. The panel shows interim words, then the captured question; a free “Copy. Checking your driving data” acknowledgment plays before the answer on a stop/straight. Starting the microphone cancels an automatic tip request while preserving pending measured-lap writes. Microphone permission, device capture, speech-service and playback failures are shown explicitly; typing remains available.


### Live commentary before your first clean lap

This project targets only the Tesla Roadster browser simulator. The engineer now observes actual current-run telemetry for off-track driving, overlapping pedals, and completed turns (minimum speed, peak lateral g, peak braking and fan state). These bounded observations feed AI coaching rather than being read aloud as routine reports. Immediate safety warnings remain local/free; automatic AI coaching uses credits and does not need a reference lap. AI explanations receive a fresh compact snapshot of pedals, g loads, tire temperature range, track position and current lap-validity status. Stale snapshots older than five seconds are excluded. Voice can play on a straight while coasting with the brake released, as well as while accelerating.

Detailed earlier/later braking recommendations still require clean comparable laps. Invalid laps are not made valid just to generate advice. Synthetic examples and CSV replays are explicitly tagged and rejected by the live engineer, live-memory ingestion, AI lap-context validation and local planning fallback. Stored demo records remain separate and are never erased to hide this distinction. Telemetry capture runs on its own 10 Hz clock; the phone state broadcast remains 5 Hz.


### AI race coaching and hands-free conversation

Enable **Automatic AI coaching (uses AI credits)** for model-generated pit-wall advice. The model receives up to three recent measured turns/events, the fresh current snapshot, your goal, compact lap comparisons, scoped Neo4j context, and the last few AI recommendations. Its job is to identify one useful next experiment and explain why, not recite telemetry. Ordinary turn/temperature/assistance reports no longer take over spoken coaching. Crash, empty-air and off-track warnings remain local; measured focus cards remain available free. Asking by voice/text to work on a skill first looks up measured evidence, then requests an AI explanation even if recurring AI coaching is off.

The prominent **Hands-free conversation · Off/On** button is directly under the voice controls. It listens for one utterance, sends on silence, waits through the acknowledgment and reply, then rearms automatically. It does not listen during its own speech, preventing self-transcription. Automatic coaching leaves a short listening window between replies. Voice off / Engineer off stops listening; pausing the game suspends it. Browser recognition failures turn hands-free off and remain visible next to the toggle, rather than retrying endlessly. The current in-app browser has previously returned `network` errors from its speech service; the control cannot make that service available. No always-on microphone access is silently enabled by page load.

Full live telemetry and recording also run in non-circuit Roadster scenarios (including Reveal Curl). Circuit position/distance fields are null there, not fabricated; lap analysis is skipped and the API is instructed to coach the scenario rather than request clean laps.
