# Tesla Roadster + AI Race Engineer

Browser-only driving simulator with ai& coaching, Neo4j driving memory, phone controls and original stylized graphics. Do not add Assetto Corsa adapters.

## Development

- Use plain JavaScript ES modules and keep dependencies small.
- Keep tunable parameters in `public/config.js`.
- Use `codex/` branches; keep main runnable and run `npm test` before pushing.
- Avoid changing shared protocol fields unnecessarily.
- Never commit `.env`, credentials, recorded telemetry, local learned maps or personal information. `.env.example` contains placeholders only.
- Preserve source attribution for OpenStreetMap, NASA data, Poly Haven textures and dependencies.
- Keep simulated examples and replay data separate from live driving and Neo4j memory.
- API keys stay server-side. Engineer Off must stop AI requests, microphone capture and speech.
- Record only real measurements as driving evidence. Do not invent optimal speeds, braking offsets or proof that advice caused an improvement.
- This is an independently maintained repository derived from a collaborative prototype. Its fresh history omits earlier contributor identities for privacy and is not a claim of sole original authorship.

## Run

`npm install`, then `npm start` (or `npm run phone` for the HTTPS phone tunnel).
Copy `.env.example` to `.env` and configure API/database access locally.
See README.md and docs/coach-integration.md for setup, data flow and current limitations.
