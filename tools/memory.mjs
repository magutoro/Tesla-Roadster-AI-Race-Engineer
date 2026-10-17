// Checks Aura or inserts isolated examples; never calls the AI provider.
import { RaceMemory, cleanLap } from "../server/memory.js";
import { MEMORY_DEMO_LAPS } from "../public/shared/memory-demo.js";
try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch {}
const memory = new RaceMemory();
try {
  let result = await memory.health();
  if (process.argv[2] === "demo" && result.status === "connected") {
    const scope = { dataset: "demo", driverId: "cli-demo", sessionId: "example-session", trackId: "suzuka", mode: "performance" };
    for (const lap of MEMORY_DEMO_LAPS) {
      result = await memory.saveLap(scope, cleanLap(lap));
      if (result.status !== "connected") break;
    }
    if (result.status === "connected") result = await memory.context(scope);
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "connected") process.exitCode = 1;
} finally { await memory.close(); }
