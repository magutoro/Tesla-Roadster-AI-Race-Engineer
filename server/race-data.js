// Raw telemetry stays on disk; only compact measured summaries go to AI/Neo4j.
import { mkdir, appendFile, writeFile, open, readFile } from "node:fs/promises";
import path from "node:path";
import { cleanTelemetrySample, telemetryCsv, CSV_FIELDS } from "../public/shared/race-telemetry.js";
async function lastSequence(file) {
  const handle=await open(file,"r");
  try {
    const {size}=await handle.stat();
    const buffer=Buffer.alloc(Math.min(size,2048));
    await handle.read(buffer,0,buffer.length,size-buffer.length);
    const line=buffer.toString().trim().split("\n").at(-1);
    const value=Number(line.split(",")[CSV_FIELDS.indexOf("sequence")]);
    return Number.isInteger(value) ? value : -1;
  } finally {await handle.close();}
}
export function installRaceDataRoutes(app, root) {
  const chains = new Map();
  app.post("/api/race-data/samples", async function (req, res) {
    let samples;
    try {
      if (!Array.isArray(req.body?.samples) || !req.body.samples.length || req.body.samples.length > 20) throw new Error("Send 1–20 samples");
      samples = req.body.samples.map(cleanTelemetrySample);
      const first=samples[0];
      if (samples.some(function (s) { return s.sessionId!==first.sessionId || s.trackId!==first.trackId; })) throw new Error("Mixed sessions");
    } catch (error) { res.status(400).json({ error: error.message }); return; }
    const first=samples[0], filename=first.trackId+"_roadster_"+first.sessionId+".csv";
    if (chains.size >= 8 && !chains.has(filename)) { res.status(429).json({ error: "logger_busy" }); return; }
    let stored=0;
    const operation=(chains.get(filename)||Promise.resolve()).catch(function () {}).then(async function () {
      const directory=path.join(root,"logs");
      await mkdir(directory,{recursive:true});
      const file=path.join(directory,filename);
      try { await writeFile(file,telemetryCsv([]),{flag:"wx"}); } catch (error) { if(error.code!=="EEXIST") throw error; }
      const sequence=await lastSequence(file);
      const fresh=samples.filter(function(s){return s.sequence>sequence;});
      if(fresh.some(function(s,i){return i>0 && s.sequence<=fresh[i-1].sequence;})) throw new Error("Samples out of order");
      await appendFile(file,telemetryCsv(fresh,false));
      stored=fresh.length;
    });
    chains.set(filename,operation);
    try { await operation; res.json({ stored: stored, file: "logs/"+filename }); }
    catch { res.status(503).json({ error: "logger_unavailable" }); }
    finally { if(chains.get(filename)===operation) chains.delete(filename); }
  });
  const identifier = function(value) {return typeof value==="string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);};
  app.get("/api/race-data/map", async function(req,res) {
    const {trackId,trackVersion,analysisVersion}=req.query;
    if (![trackId,trackVersion,analysisVersion].every(identifier)) {res.status(400).json({error:"Invalid map key"});return;}
    try {res.json(JSON.parse(await readFile(path.join(root,"tracks",trackId+"_"+trackVersion+"_"+analysisVersion+".json"),"utf8")));}
    catch {res.status(404).json({error:"map_not_found"});}
  });
  app.post("/api/race-data/map", async function (req,res) {
    const map=req.body;
    if (!map || ![map.trackId,map.version,map.trackVersion,map.analysisVersion].every(identifier) ||
        !Array.isArray(map.corners) || map.corners.length>32 || !Number.isFinite(map.length) || map.length<=0 ||
        map.corners.some(function(c) { return !/^T[1-9][0-9]?$/.test(c.name)|| ![c.start,c.end,c.apex].every(Number.isFinite) || c.start<0 || c.end>map.length || c.start>=c.end || c.apex<c.start || c.apex>c.end; })) {
      res.status(400).json({error:"Invalid corner map"}); return;
    }
    try {
      await mkdir(path.join(root,"tracks"),{recursive:true});
      await writeFile(path.join(root,"tracks",map.trackId+"_"+map.trackVersion+"_"+map.analysisVersion+".json"),JSON.stringify(map,null,2),{flag:"wx"});
      res.json({stored:true});
    } catch(error) { if(error.code==="EEXIST") res.json({stored:true}); else res.status(503).json({error:"map_storage_unavailable"}); }
  });
}
