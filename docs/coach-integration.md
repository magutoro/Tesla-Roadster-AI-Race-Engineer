# Race engineer integration

Ownership update: the friend now implements browser telemetry, lap/corner analysis, AI engineer and voice (milestones 1–4). The coach consumes existing `makeState()` locally and completed comparisons from `RaceSession`/`LapAnalyzer`; both work without a phone connected.

## Run

Copy `.env.example` to `.env` and fill in `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` from ai&. The base URL should include the API version, for example `https://api.aiand.com/v1`. Restart `npm start` after changing `.env`. Credentials stay on the server and `.env` is ignored by Git.

Open `/game.html`, choose Free drive, and watch the Race engineer panel. **The engineer starts off, and automatic tips start unchecked.** Turn Engineer on to ask questions. Automatic tips require a separate opt-in because they may make recurring paid AI calls. Eligible measured cues and outcome reports use deterministic analysis without an AI call. Turning Engineer off cancels browser requests, microphone capture and speech, clears queued questions, and prevents further AI requests from that tab. The server aborts upstream work when the browser disconnects. A request already received by the provider may still incur charges. Older tabs without explicit opt-in are rejected by the server.

Choose an installed English or Japanese voice in Mac / browser voice and use **Preview voice · free** to compare voices without any AI request, even while the engineer is off. No paid speech service is used. Available voices depend on the browser and installed system voices; additional voices can be downloaded through macOS Accessibility > Read & Speak (Spoken Content on older macOS versions).

Click Voice on for spoken tips. Click Talk to engineer, allow microphone access, speak, then click Finish talking. Alternatively, hold V and release to submit. Starting a conversation enables spoken replies; turning Voice off stops microphone capture and cancels the recording. The panel shows the transcribed question. You can always type a question. Speech recognition depends on the browser and may send audio to its speech service; this prototype does not use local Whisper. Routine speech waits until stopped or on a straight with throttle, pauses during corners, and expires instead of building a backlog.

Open `/coach-lab.html` to test with clearly labeled sample states without driving. Practice tips are rule based, not AI, and labeled as such. Missing settings, busy/failed providers and timeouts keep the game running. Question fallback explicitly reports that AI is unavailable. Crash, flip and empty-tank callouts are immediate rules and may interrupt speech. Resetting a scenario discards old context and replies.

## Live lap-summary connection

When analysis finishes a valid lap, dispatch a compact **measured text summary** in the game browser:

```js
window.dispatchEvent(new CustomEvent("race:lap-summary", {
  detail: "Lap 3: T4 braked 12 m earlier than best, minimum speed 6 km/h slower, lost 0.35 s."
}));
```

Use actual analysis values, not this example. The coach retains the latest five summaries in that browser tab, sends them with coaching requests, and clears them when changing levels. Summaries should use consistent corner names and include lap numbers to support trend detection. Optional Neo4j persistence now stores summaries while the engineer is on and retrieves past laps for the same browser driver, track, and car mode. See [Neo4j setup](neo4j-memory.md) for credentials and the structured lap format.

The existing shared state/phone protocol is unchanged. The small `game.js` adapter also passes throttle directly to the voice scheduler; throttle is not added to the phone message format.

## Server contract

`POST /api/coach` requires explicit `enabled: true` and accepts:

```js
{ enabled: true, state: carState, lang: "en", question: "Where am I losing time?", history: ["Lap 3: …"] }
```

Response: `{ type: "tip", text, lang, source: "ai" | "fallback" | "analysis", latencyMs, reason?, memory?, coaching? }`. Bad state returns HTTP 400. No credentials are returned. The server calls the OpenAI-compatible `/chat/completions` endpoint using native Node fetch. Tunables, request timeout, speech timing, language default and input limits are in `public/config.js` under `coach`.

## Validation

Run `npm test`. Tests cover telemetry validation, bounded lap history, provider payload/auth isolation, offline fallback, timeout recovery, and speech waiting/expiry. Browser microphone permissions, actual spoken audio and provider latency should also be checked on the demo laptop.

## Recommendation and outcome handoff

For automatic measured coaching, use the [structured lap format](neo4j-memory.md#structured-analysis-handoff), including `valid`, immutable reference/track/physics/setup identifiers, and timestamps recorded during driving. Text summaries alone cannot evaluate whether a driver changed technique after advice.

`POST /api/memory/focus` (enabled + scope) selects and persists one evidence-backed cue without AI. `/api/memory/focus/ack` marks its ID shown; `/api/memory/focus/dismiss` dismisses it. `/api/memory/laps` stores an immutable payload and evaluates a pending cue against the first eligible later attempt. These operations retain driver/track/mode/dataset scoping. Their response uses `status` and `data`; missing credentials/busy/unavailable storage never stop the simulator. Failed writes currently need another producer retry; no durable queue is implemented.

Coach responses can include `coaching: { focus, outcome }`. The evidence card displays the recommendation, supporting sample count and measured outcome. `source: analysis` means a deterministic cue, not a paid model response. Questions still use ai& with the measured focus/outcome in context. Shared phone/state WebSocket messages are unchanged.

## Goal-based practice

Type or say “I want to work on corner speed at T4”, “I want to improve my braking”, or “I want to practice corner exit”. Explicit goal statements set the skill and optional corner. The Practice goal selector offers the same choices. Other questions retain the existing goal; up to four recent question/answer pairs accompany follow-ups as conversational context, not evidence. Goals last for this browser page; track/mode resets clear measurements and conversation.

Selecting a goal requests a free measured plan through `/api/memory/focus`. Incoming lap-summary events trigger free plan updates for every goal even when automatic paid tips are unchecked. The engineer must still be on. Questions and typed/spoken goals request AI explanation after evidence lookup; goal selection does not opt into recurring paid requests. Speech still waits for a stop or straight. This is analysis after measured laps, not turn-by-turn timing of spoken cues.

Goal filtering restricts braking practice to braking offsets, corner-exit practice to throttle pickup, and an explicit corner to that corner. The evidence card includes the reference-relative minimum speed, braking/throttle offset, supporting sample count and average measured loss. Missing measurements produce a data-collection plan. More speed alone does not establish a braking adjustment or prove a causal improvement.

The browser analyzer now supplies `corners[].brakedEarlySeconds` where both braking points were measured: positive means earlier, negative means later than the fixed reference, using aligned measured braking-event timing. This is independent of `timeLostSeconds`, which measures performance loss. If its sign agrees with the measured braking-distance error, a cue can use up to half the timing offset, capped at 0.3 s. Distance cues remain capped at 5 m. These are alternative units, not a conversion using the car's current speed. Earlier-braking cues are also supported when repeated measured braking offsets are negative. Without timing data, cues stay in metres. Throttle lift-off timing is not measured by the current contract; the engineer must not invent an exact lift point.

When Aura is unavailable, the server can validate the latest five structured lap objects from this tab and produce a local plan. The UI retains the database failure status; local cues are not acknowledged as graph-backed recommendations and cannot claim persistent graph outcome tracking. When Aura is connected, the graph remains the source of history; changing practice goals supersedes the old pending focus when a new supported recommendation is prepared. A new focus carries its goal type/corner for later scoped outcomes.

`race-session.js` now dispatches real `race:lap-summary` events from complete valid circuit laps. It samples the car at 10 Hz, projects onto the 3D centerline relative to the actual start line, and calls shared `LapAnalyzer`. The first clean lap learns/fixes a turn map; subsequent laps use the fastest clean reference available at their start. Reference IDs, geometry/map version, physics configuration hash and fixed fan/trim setup keep comparisons isolated. Epoch observation times come from actual sample capture; timing offsets use the reference's simulation-time trace. No simulator physics or phone message formats change.


### Capture and replay contract

`POST /api/race-data/samples` validates at most 20 samples, appends local CSV asynchronously, serializes writes per file, and deduplicates by session sequence number (also after server restart). Path components are strict identifiers. `POST /api/race-data/map` persists a learned map once; `GET /api/race-data/map` reloads by track, geometry and analysis version. These local routes do not call AI or store raw samples in Neo4j. The game retains a bounded local download buffer and reports disk failures visibly.

The shared CSV columns and parser are in `shared/race-telemetry.js`. `race-replay.js` accepts a single chronological session and replays it at recorded speed through `LapAnalyzer` and `RaceEngineer({dataset: "demo"})`. Replay assigns its own session ID and playback observation timestamps, preserving recorded simulation time/position for comparisons. It cannot add lap data to the live dataset. The synthetic fixture is explicitly labeled and used for regression checks; it is not a driving reference for real sessions.

Turn windows are learned from sustained steering/lateral-g runs on the first valid lap and cached. Reported T-numbers are learned simulator sectors, not official Suzuka corner names. Brake events require pedal input above the configured threshold; throttle pickup requires a preceding release and pickup after the minimum-speed sample. Missing events remain null. Sampling limits braking precision to the captured 10 Hz trace. This is coaching evidence, not an optimal racing line or proof that a different brake point will improve time.


Scope: Tesla Roadster browser simulator only. `shared/live-coaching.js` provides immediate measured turn/off-track/pedal observations before a reference exists. Optional fresh `state.telemetry` augments AI context; snapshots are limited to five seconds of age and demo/replay context cannot receive them as live evidence. Example/replay lap source tags are rejected at live ingestion and planning boundaries. The recorder runs independently from the phone broadcast clock.


`explain: true` on `/api/coach` requests AI interpretation even when deterministic focus/outcome evidence exists. Up to three sanitized live observations from the last 30 seconds and bounded `recentCoaching` support continuity; they are data, not instructions. Browser automatic coaching opts into this path; local safety warnings and free focus endpoints are unchanged. `EngineerVoice.setHandsFree()` / `pollHandsFree()` rearm single-utterance recognition between replies, block self-listening, yield to API work, and disable on persistent service/device/permission errors. The top-panel toggle and a separate persistent microphone status expose these states.

### Conversational stunt demo

In Free drive, **Engineer on** enables AI coaching and spoken output together. It also attempts hands-free recognition; a browser speech-service failure stops recognition and stays visible without disabling coaching. Off aborts the active request, microphone and speech. Settings remain under a collapsed disclosure.

Ask “Take me through the Reveal Curl” or “Take me through how to do the Reveal Jump”. The game loads the requested scenario and starts a measured guide. Curl and Jump have separate recipes. Position, orientation, current gas/brake/steering/BOOST/LIFT/ROLL, actual landing/impact events and the game's goal flag drive the stages. Short immediate phase cues are local; ai& interprets the current stage, observed input issues and the previous three attempts. Approach speeds are experiments, not validated optimal speeds. Only the game's goal completion confirms success. Reset preserves the guide and previous attempts; changing levels clears it. No autopilot or example telemetry is injected.

**Review chat & input records** opens `/engineer-chat.html`. The thread includes questions, model replies, labeled local cues, attempt transitions and input snapshots (every two seconds, plus changes in special controls, fan state or trim). These are snapshots, not every frame; raw 10 Hz CSV data remains available in Driving data. The journal is browser-local on this origin, survives reloads, and retains five sessions of up to 600 records each. It is not a Neo4j chat archive and does not sync across devices or changing tunnel domains. Each session can be downloaded as JSON. Storage failure is shown in the panel.

### Phone tilt flips

Refresh the phone controller after updating. In Rocket mode, center the phone while airborne (or inverted on the curl), then tilt past 45° left/right to request one automatic barrel roll in that direction. Return within 12° of center to rearm. Normal grounded steering never triggers a flip; a steering angle already held at takeoff also requires centering first. The ROLL button remains available for ground hop-and-rolls and drag-yoke users.

The phone sends a 150 ms pulse using the existing `roll` input, with a 1.2 s cooldown and no yaw steering from a committed roll gesture. Fresh motion and game state are required; the existing physics still enforces Rocket trim and the air cost. No protocol or car physics changes are needed. Sensor handling and outgoing packets are covered by tests; verify the physical gesture on the actual phone before presenting.
