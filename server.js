// server.js — Phone/server integration
// Serves the game and phone pages, relays phone input to the game over WebSocket,
// and (later) proxies AI requests so the API key never reaches the browser.
//
//   npm start             -> laptop only (http://localhost:3000)
//   npm run phone         -> also opens an HTTPS tunnel so an iPhone can connect
//                            (tries Cloudflare first, then ngrok if Cloudflare doesn't work)
//   npm run phone:ngrok   -> skip Cloudflare and use ngrok right away

import express from "express";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import QRCode from "qrcode";
import { installRaceDataRoutes } from "./server/race-data.js";
import { installCoachRoutes } from "./server/ai.js";
import { RaceMemory, installMemoryRoutes } from "./server/memory.js";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Load .env if there is one. Node 20.12+ has this built in, so we don't need dotenv.
try {
  process.loadEnvFile(path.join(rootDir, ".env"));
} catch (err) {
  // No .env file yet. The prototype works without it.
}

const PORT = Number(process.env.PORT) || 3000;

// Which tunnel to open: none, "auto" (Cloudflare, then ngrok), or "ngrok".
let tunnelChoice = "none";
for (const arg of process.argv) {
  if (arg === "--tunnel") {
    tunnelChoice = "auto";
  }
  if (arg === "--tunnel=ngrok") {
    tunnelChoice = "ngrok";
  }
}

// The public HTTPS address from the tunnel, once the tunnel tool tells us. Shown as a QR code.
let tunnelUrl = null;
let tunnelTool = null; // "cloudflared" or "ngrok"
let tunnelProcess = null;

// ---------- Web pages and files ----------

const app = express();
// Behind the tunnel, trust its "this was really https" header.
app.set("trust proxy", true);
app.use(express.json({ limit: "100kb" }));

// Libraries come straight from node_modules, so we don't need a bundler.
app.use("/vendor/three", express.static(path.join(rootDir, "node_modules/three")));
app.use("/vendor/rapier", express.static(path.join(rootDir, "node_modules/@dimforge/rapier3d-compat/dist")));
app.use("/levels", express.static(path.join(rootDir, "levels")));
app.use("/fixtures", express.static(path.join(rootDir, "fixtures")));
app.use(express.static(path.join(rootDir, "public")));

app.get("/", function (req, res) {
  res.redirect("/game.html");
});
app.get("/phone", function (req, res) {
  res.redirect("/phone.html");
});

// The game asks this to know what to put in the QR code.
app.get("/api/info", function (req, res) {
  res.json({ phoneUrl: getPhoneUrl(req), tunnel: tunnelUrl !== null, tunnelTool: tunnelTool });
});

app.get("/api/qr.svg", async function (req, res) {
  const svg = await QRCode.toString(getPhoneUrl(req), { type: "svg", margin: 1 });
  res.type("image/svg+xml").send(svg);
});

// Friend's coach endpoint; scenario generation is a separate milestone.
const memory = new RaceMemory();
installMemoryRoutes(app, memory);
installRaceDataRoutes(app, rootDir);
installCoachRoutes(app, { memory: memory });

function getPhoneUrl(req) {
  if (tunnelUrl) {
    return tunnelUrl + "/phone.html";
  }
  // No tunnel. Use the address the game was opened with, but swap "localhost" for the
  // laptop's Wi-Fi address so a phone on the same network can reach it.
  // (iPhones still need the tunnel, because tilt only works over HTTPS.)
  let host = req.get("host");
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
    host = getLanAddress() + ":" + PORT;
  }
  return req.protocol + "://" + host + "/phone.html";
}

function getLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const item of interfaces[name]) {
      if (item.family === "IPv4" && !item.internal) {
        return item.address;
      }
    }
  }
  return "localhost";
}

// ---------- WebSocket relay ----------
// Phones send input. The server passes phone messages to every game screen,
// and game messages to every phone. Each socket says who it is with a "hello" message.

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", function (socket) {
  socket.role = "unknown";
  socket.isAlive = true;

  socket.on("pong", function () {
    socket.isAlive = true;
  });

  socket.on("message", function (data) {
    const text = data.toString();
    let msg = null;
    try {
      msg = JSON.parse(text);
    } catch (err) {
      return; // ignore anything that isn't JSON
    }
    if (!msg || typeof msg.type !== "string") {
      return;
    }

    if (msg.type === "hello") {
      if (msg.role === "phone" || msg.role === "game") {
        socket.role = msg.role;
        console.log("A " + msg.role + " connected.");
        broadcastStatus();
      }
      return;
    }

    // Pass the original text along. No need to re-encode it.
    if (socket.role === "phone") {
      sendToRole("game", text);
    } else if (socket.role === "game") {
      sendToRole("phone", text);
    }
  });

  socket.on("close", function () {
    if (socket.role !== "unknown") {
      console.log("A " + socket.role + " disconnected.");
    }
    broadcastStatus();
  });
});

// A phone that goes to sleep can leave a dead connection behind. Ping everyone
// every few seconds and drop sockets that stop answering.
setInterval(function () {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 5000);

function sendToRole(role, text) {
  for (const socket of wss.clients) {
    if (socket.role === role && socket.readyState === socket.OPEN) {
      socket.send(text);
    }
  }
}

function broadcastStatus() {
  let phones = 0;
  let games = 0;
  for (const socket of wss.clients) {
    if (socket.readyState !== socket.OPEN) {
      continue;
    }
    if (socket.role === "phone") {
      phones = phones + 1;
    }
    if (socket.role === "game") {
      games = games + 1;
    }
  }
  const text = JSON.stringify({ type: "status", phones: phones, games: games });
  for (const socket of wss.clients) {
    if (socket.readyState === socket.OPEN) {
      socket.send(text);
    }
  }
}

// ---------- HTTPS tunnel (for the iPhone) ----------
// iPhones only share tilt data with HTTPS pages, so we open a tunnel that gives this
// laptop a temporary public https:// address.

const TUNNELS = {
  cloudflared: {
    args: ["tunnel", "--no-autoupdate", "--url", "http://localhost:" + PORT],
    // cloudflared prints its random https://....trycloudflare.com address in its log.
    urlPattern: /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/,
  },
  ngrok: {
    args: ["http", String(PORT), "--log", "stdout", "--log-format", "logfmt"],
    // ngrok prints a log line containing url=https://....ngrok-free.app
    urlPattern: /url=(https:\/\/[^\s"]+)/,
  },
};
const TUNNEL_TIMEOUT_MS = 20000;

// Start one tunnel tool. If it fails or is too slow, call ifItFails().
function startTunnel(tool, ifItFails) {
  console.log("Starting " + tool + " tunnel (takes a few seconds)...");
  const child = spawn(tool, TUNNELS[tool].args, { stdio: ["ignore", "pipe", "pipe"] });
  tunnelProcess = child;
  let failed = false;

  function fail(reason) {
    if (failed || tunnelUrl) {
      return;
    }
    failed = true;
    clearTimeout(timer);
    console.log(tool + " didn't work (" + reason + ").");
    child.kill();
    ifItFails();
  }

  const timer = setTimeout(function () {
    fail("no address after " + TUNNEL_TIMEOUT_MS / 1000 + " s; this network may block it");
  }, TUNNEL_TIMEOUT_MS);

  child.on("error", function () {
    fail("is it installed?");
  });

  function lookForUrl(chunk) {
    const match = chunk.toString().match(TUNNELS[tool].urlPattern);
    if (match && !tunnelUrl && !failed && !match[1].startsWith("https://api.")) {
      clearTimeout(timer);
      tunnelUrl = match[1];
      tunnelTool = tool;
      printPhoneInstructions();
    }
  }
  child.stdout.on("data", lookForUrl);
  child.stderr.on("data", lookForUrl);
}

function noTunnelWorked() {
  console.log("");
  console.log("No tunnel could start, so the iPhone controller won't work right now.");
  console.log("The game still works on this laptop with the keyboard. See the README (Phone setup).");
}

// Stop the tunnel when the server stops (Ctrl+C).
process.on("exit", function () {
  if (tunnelProcess) {
    tunnelProcess.kill();
  }
});
process.on("SIGINT", function () {
  process.exit(0);
});

async function printPhoneInstructions() {
  const phoneUrl = tunnelUrl + "/phone.html";
  const terminalQr = await QRCode.toString(phoneUrl, { type: "terminal", small: true });
  console.log("");
  console.log("Phone controller (HTTPS):  " + phoneUrl);
  console.log(terminalQr);
  console.log("Scan the QR code on the game screen or above with your iPhone camera.");
  if (tunnelTool === "ngrok") {
    console.log("ngrok shows a warning page first: tap \"Visit Site\".");
  }
}

server.listen(PORT, function () {
  console.log("");
  console.log("Roadster Sim running.");
  console.log("Game on this laptop:  http://localhost:" + PORT);
  if (tunnelChoice === "auto") {
    startTunnel("cloudflared", function () {
      startTunnel("ngrok", noTunnelWorked);
    });
  } else if (tunnelChoice === "ngrok") {
    startTunnel("ngrok", noTunnelWorked);
  } else {
    console.log("For an iPhone controller, stop this and run:  npm run phone");
  }
});
