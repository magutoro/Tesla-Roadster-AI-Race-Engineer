# Tesla Roadster Simulator

A browser driving simulator with phone tilt steering, fan downforce, compressed-air thrusters and stunt scenarios. Drive with the keyboard or use a phone as your steering yoke.

This version is **just the game**. No API keys, accounts or database setup are required. It does not capture microphone audio or run an AI engineer.

The car is an original stylized model inspired by the Tesla Roadster. This project is not affiliated with Tesla and uses no Tesla logos, official assets or 3D models. Its physics and stunt behavior are experimental simulation settings, not validated real-car performance.

## Run locally

Requires Node.js 20.12 or newer.

```sh
npm install
npm start
```

Open http://localhost:3000/game.html. Keyboard controls work immediately. To choose another port:

```sh
PORT=3100 npm start
```

After dependencies are installed, the laptop game is served locally. The optional phone tunnel needs an internet connection.

## Drive with your phone

1. Install Cloudflare's tunnel tool: `brew install cloudflared`.
2. Run `npm run phone`.
3. Open the laptop game and scan its QR code with your phone.
4. Turn on Portrait Orientation Lock, tap **Tap to start**, and allow motion access.
5. Hold your phone sideways and tap **CENTER**. Use **FLIP VIEW** if the controls appear upside down.

The tunnel provides HTTPS, which iPhones require for tilt sensing. Its temporary address changes when the server restarts, so rescan the QR code afterward. Cloudflare does not require an account for this setup. If the tunnel cannot connect, keyboard driving still works; the optional `npm run phone:ngrok` fallback requires a separately configured ngrok account.

If tilt is unavailable, drag the on-screen yoke to steer. Keep the phone page open while playing.

## Controls

| Action | Keyboard | Phone |
|---|---|---|
| Steer | A / D or left / right arrows | Tilt left / right or drag the yoke |
| Gas | W | Hold GAS |
| Brake / reverse | S | Hold BRAKE |
| Toggle fans | F | FANS |
| Rear BOOST | Space | Hold BOOST |
| LIFT (Rocket) | Shift | Hold LIFT |
| Lean LIFT forward / back | Up / down arrows | Tip the phone forward / back |
| Barrel roll (Rocket) | Q / E | Tap ROLL, or use the tilt gesture below |
| Performance / Thrust / Rocket trim | 1 / 2 / 3 | MODE |
| Reset at spawn | R | RESET |
| Recenter tilt | — | CENTER |
| Camera view | C or the camera menu | — |
| Racing line | G | — |
| Telemetry panel | T | — |
| Sound | M | — |
| Presentation mode | P | — |
| Next scenario | L | — |
| Menu | Esc | — |
| Next guided-demo scene | N | — |

### Phone tilt flips

In **Rocket** mode, center the phone while airborne or upside down on the curl. Tilt past **45° left or right** to request one automatic barrel roll in that direction. Return within roughly 12° of center before another flip.

Normal ground steering does not trigger flips. A steering angle already held at takeoff requires centering before it can trigger a roll. The ROLL button remains available for a hop-and-roll from the ground. Thrusters require sufficient tank air.

## Game features

- Three trims: Performance, Thrust and Rocket.
- Tire forces, suspension, braking/regen, traction control, ABS, stability control and aerodynamic forces running with a 120 Hz physics step.
- Electric fan downforce, finite-air BOOST and LIFT, automatic barrel rolls and landing assistance.
- Chase, cockpit, overhead and showroom cameras; use the camera menu or C.
- A speed-adaptive racing line, live telemetry panel and procedural vehicle sound.
- A built-in guided demo with on-screen hints. These hints are part of the game and require no external service.

## Scenarios

Choose a scenario from the upper-right menu:

- **Blank Test Area:** practice controls and stunts.
- **Reveal Curl:** use fans to drive up the curved ramp, barrel roll off the top, and land in the green zone.
- **Reveal Jump:** launch over the parked vehicle lineup and reach the green zone beyond the landing ramp.
- **Suzuka Circuit:** track layout and elevation built from geographic data, with a crossover bridge, gravel, guardrails and grandstands.
- **Figure-8 Circuit:** pass checkpoints and set a lap time.
- **Warehouse Store Parking:** reach and occupy the free parking space before the rival car.
- **Rush-Hour Expressway:** navigate traffic and reach the exit before time runs out.

The title screen offers **Guided demo** and **Free drive**. P hides help panels for presentations; T opens detailed car telemetry.

## Configuration and checks

Gameplay and physics settings live in `public/config.js`. Scenario definitions are in `levels/`; their menu is `levels/index.json`. The server handles local file serving and the phone's WebSocket connection.

```sh
npm test
```

The automated checks cover phone orientation, portrait-lock steering, calibration and tilt-roll input behavior. Check motion permissions and the physical tilt gesture on the actual phone before a demo.

To rebuild the optional Suzuka geographic data, run `node tools/build-suzuka.mjs`. This development tool downloads public map/elevation data; it is not required to run the bundled track.

## Repository privacy

This independently maintained repository was derived from a collaborative prototype. Earlier contributor identities and original Git history were omitted for privacy; that is not a claim of sole original authorship. Do not commit credentials or personal information. Keep the repository private unless you intentionally choose to publish it.

## Credits

- Suzuka track layout: © OpenStreetMap contributors, available under the Open Database License (ODbL), https://www.openstreetmap.org/copyright
- Elevation: NASA SRTM (30 m), fetched through the OpenTopoData API.
- Textures (asphalt, grass, concrete and gravel): Poly Haven, CC0, https://polyhaven.com
- Libraries: three.js, Rapier, Express, ws and qrcode.
