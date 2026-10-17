# Roadster Simulator

Browser-only driving simulator with phone controls and original stylized graphics. No AI engineer, inference APIs or database integrations. Do not add Assetto Corsa adapters.

## Development

- Use plain JavaScript ES modules and keep dependencies small.
- Keep tunable parameters in `public/config.js`.
- Use `codex/` branches; keep main runnable and run `npm test` before pushing.
- Avoid changing shared protocol fields unnecessarily.
- Never commit `.env`, credentials, recorded telemetry, local learned maps or personal information. `.env.example` contains placeholders only.
- Preserve source attribution for OpenStreetMap, NASA data, Poly Haven textures and dependencies.
- This is an independently maintained repository derived from a collaborative prototype. Its fresh history omits earlier contributor identities for privacy and is not a claim of sole original authorship.

## Run

`npm install`, then `npm start` (or `npm run phone` for the HTTPS phone tunnel).
No API keys or database setup are required. `PORT` can be set as an environment variable. See README.md for controls and setup.
