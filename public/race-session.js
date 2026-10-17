// Adapts the browser car to the same telemetry -> analysis -> engineer path used by CSV replay.
import { liveSnapshot } from "./shared/live-coaching.js";
import { CONFIG } from "./config.js";
import { TrackPosition, stableId, telemetryCsv } from "./shared/race-telemetry.js";
import { LapAnalyzer, telemetryCallouts } from "./shared/lap-analysis.js";
export class RaceSession {
  constructor(onLap,onEvents) {
    this.onEvents=onEvents;
    this.analyzer=new LapAnalyzer({onLap:function(lap){this.lastLap=lap;this.result.textContent=lap.summary;onLap({...lap,source:"live"});}.bind(this),
      onStatus:function(text){if(text.startsWith("Lap ignored")) this.result.textContent=text; else this.status.textContent=text;}.bind(this),onMap:this.saveMap.bind(this)});
    this.element=document.createElement("details");this.element.id="race-data";
    this.element.innerHTML='<summary>Driving data · 10 Hz</summary><p class="race-data-status">Choose a circuit to analyse laps.</p><p class="race-lap-result">No clean reference lap yet.</p><p class="race-log-status">Local CSV recording ready.</p><button type="button">Download telemetry CSV</button> <a href="/race-replay.html" target="_blank">Replay a recording</a>';
    document.body.appendChild(this.element);
    this.status=this.element.querySelector('.race-data-status');this.logStatus=this.element.querySelector('.race-log-status');this.result=this.element.querySelector('.race-lap-result');
    this.element.querySelector('button').onclick=this.download.bind(this);
    this.rows=[];this.queue=[];this.writing=false;this.lastFlush=0;this.lastSample=-Infinity;this.paused=true;
    setInterval(this.flush.bind(this), 2000);
    document.addEventListener("visibilitychange", function () {if(document.hidden) this.flush();}.bind(this));
  }
  configure(track,trackId) {
    this.projector=track ? new TrackPosition(track) : null;this.trackId=trackId;
    this.reset();
    if (this.projector) {
      try {
        const cached=JSON.parse(window.localStorage.getItem("race-map-"+this.trackId+"-"+this.projector.version));
        if(cached && cached.analysisVersion===stableId(CONFIG.analysis) && cached.length===this.projector.length && cached.corners?.length) this.analyzer.maps.set(this.trackId+":"+this.projector.version,cached);
      } catch {}
    }
    if (this.projector) this.loadMap();
    this.status.textContent=track ? "Out-lap · cross the start line to begin recording" : "Live Roadster telemetry active · this scenario has no circuit laps.";
  }
  reset() {
    this.sessionId="run-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
    this.sequence=0;this.lastSample=-Infinity;this.analyzer.reset();this.analyzer.best.clear();this.lastLap=null;this.latestSample=null;this.liveContext=null;this.callouts=new Map();this.paused=true;
    this.result.textContent=this.projector ? "No clean reference lap yet." : "Live coaching does not require circuit laps here.";
  }
  sample(car,input,timeSeconds,paused,events=[]) {
    this.element.hidden=document.body.classList.contains("atTitle");
    if(paused) {this.analyzer.invalidate("paused");this.paused=true;return;}
    if(events.includes("crash") || events.includes("flip")) this.analyzer.invalidate("impact");
    const interval=1/CONFIG.analysis.sampleRateHz;
    if(timeSeconds-this.lastSample<interval-0.000001) return;
    this.lastSample=Number.isFinite(this.lastSample) && timeSeconds-this.lastSample<interval*2 ? this.lastSample+interval : timeSeconds;this.paused=false;
    const t=car.telemetry,w=t.wheels,position=this.projector ? this.projector.project(car.getPosition()) : {distanceMeters:null,normalizedCarPosition:null,lateralOffsetMeters:null};
    const physicsVersion="physics-"+stableId({car:CONFIG.car,physics:CONFIG.physics,fans:CONFIG.fans,thrusters:CONFIG.thrusters,rocket:CONFIG.rocket,air:CONFIG.air,surfaces:CONFIG.surfaces});
    const sample={sessionId:this.sessionId,trackId:this.trackId,trackVersion:this.projector?.version || "scene-"+stableId(this.trackId),physicsVersion:physicsVersion,
      setupId:car.mode+"-fans-"+(car.fansOn ? "on" : "off"),mode:car.mode,sequence:this.sequence++,timestampMs:Date.now(),timeSeconds:timeSeconds,
      ...position,trackLengthMeters:this.projector?.length ?? null,trackWidthMeters:this.projector?.width ?? null,speedKmh:car.speedKmh,throttle:input.gas,brake:input.brake,
      steer:input.steer,steerDegrees:t.steerDeg,gLat:t.gLat,gLong:t.gLong,airborne:car.airborne,fansOn:car.fansOn,tankPercent:car.tank,
      absActive:t.abs,tractionControlActive:t.tractionControl,tireFL:w[0].tempC,tireFR:w[1].tempC,tireRL:w[2].tempC,tireRR:w[3].tempC,
      crash:events.includes("crash")||events.includes("flip"),gear:null,rpm:null};
    if(this.projector) this.analyzer.push(sample);
    sample.lapNumber=this.analyzer.lapNumber;
    sample.lapTimeSeconds=this.analyzer.samples ? Math.max(0,timeSeconds-this.analyzer.samples[0].timeSeconds) : 0;
    this.latestSample=sample;
    this.liveContext=liveSnapshot(sample,Array.from(this.analyzer.reasons));
    this.rows.push(sample);if(this.rows.length>CONFIG.analysis.maximumBufferedSamples) this.rows.shift();
    if(this.queue.length<CONFIG.analysis.maximumBufferedSamples) this.queue.push(sample);
    else this.logStatus.textContent="Disk logger backlog full · download the local CSV.";
    this.onEvents(telemetryCallouts(sample,this.callouts));
    if(this.queue.length && performance.now()-this.lastFlush>2000) this.flush();
  }
  async flush() {
    if(this.writing || !this.queue.length) return;
    this.writing=true;this.lastFlush=performance.now();
    // Never mix reset/track sessions in one append batch.
    const first=this.queue[0];
    const batch=[];
    for(const sample of this.queue.slice(0,CONFIG.analysis.logBatchSamples)) {
      if(sample.sessionId!==first.sessionId || sample.trackId!==first.trackId) break;
      batch.push(sample);
    }
    try {
      const response=await fetch('/api/race-data/samples',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({samples:batch}),signal:AbortSignal.timeout(5000)});
      if(!response.ok) throw new Error('logger');
      const result=await response.json();this.queue.splice(0,batch.length);
      this.logStatus.textContent="Saved to "+result.file+" · local download keeps latest "+CONFIG.analysis.maximumBufferedSamples/CONFIG.analysis.sampleRateHz/60+" minutes.";
    } catch {this.logStatus.textContent="Disk logger unavailable · recording locally; retrying. Download CSV for backup.";}
    finally {this.writing=false;}
  }
  async loadMap() {
    const projector=this.projector,trackId=this.trackId;
    try {
      const query=new URLSearchParams({trackId:trackId,trackVersion:projector.version,analysisVersion:stableId(CONFIG.analysis)});
      const response=await fetch('/api/race-data/map?'+query);
      if(!response.ok) return;
      const map=await response.json();
      const key=trackId+":"+projector.version;
      if(this.projector===projector && !this.analyzer.maps.has(key)) this.analyzer.maps.set(key,map);
    } catch {}
  }
  async saveMap(map) {
    map.analysisVersion=stableId(CONFIG.analysis);
    try {
      const key="race-map-"+this.trackId+"-"+this.projector.version;
      try {window.localStorage.setItem(key,JSON.stringify(map));} catch {}
      const response=await fetch('/api/race-data/map',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(map)});
      if(!response.ok) throw new Error('map');
    } catch {this.logStatus.textContent="Corner map available this session; map persistence unavailable.";}
  }
  download() {
    // A single session is replayable; old sessions remain saved on the server.
    const samples=this.rows.filter(function(s){return s.sessionId===this.sessionId;}.bind(this));
    const url=URL.createObjectURL(new Blob([telemetryCsv(samples)],{type:'text/csv'}));
    const a=document.createElement('a');a.href=url;a.download=this.trackId+'_roadster_'+this.sessionId+'.csv';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);
    this.flush();
  }
}
