import { CONFIG } from "../config.js";
import { stableId } from "./race-telemetry.js";
const round = function (n) { return Math.round(n*1000)/1000; };
// Learn once from a complete clean lap, then keep turn IDs/windows fixed.
export function detectCorners(samples, length, trackId, trackVersion) {
  const c=CONFIG.analysis, runs=[];
  let run=null;
  for (const s of samples) {
    const turning=s.speedKmh>=c.cornerMinimumSpeedKmh && (Math.abs(s.steerDegrees)>=c.cornerSteerDegrees || Math.abs(s.gLat)>=c.cornerLateralG);
    const direction=Math.sign(s.steerDegrees || s.gLat);
    if (!turning) continue;
    if (!run || s.distanceMeters-run.end>c.cornerMergeGapMeters || direction!==run.direction) {
      run={start:s.distanceMeters,end:s.distanceMeters,apex:s.distanceMeters,peak:0,direction:direction}; runs.push(run);
    }
    run.end=s.distanceMeters;
    const strength=Math.abs(s.gLat)+Math.abs(s.steerDegrees)/10;
    if(strength>run.peak) {run.peak=strength;run.apex=s.distanceMeters;}
  }
  const kept=runs.filter(function(r){return r.end-r.start>=c.cornerMinimumLengthMeters;}).slice(0,32);
  const corners=kept.map(function(r,i){
    const before=i ? (kept[i-1].end+r.start)/2 : 0;
    const after=i+1<kept.length ? (r.end+kept[i+1].start)/2 : length;
    return {name:"T"+(i+1),start:Math.max(before,r.start-c.brakeLookbackMeters),end:Math.min(after,r.end+c.cornerExitMeters),apex:r.apex};
  });
  return {trackId:trackId,trackVersion:trackVersion,analysisVersion:stableId(c),version:"map-"+stableId({trackVersion:trackVersion,corners:corners,analysis:c}),length:length,corners:corners};
}
function atDistance(samples,distance,key) {
  for(let i=1;i<samples.length;i++) {
    const a=samples[i-1],b=samples[i];
    if(a.distanceMeters<=distance && b.distanceMeters>=distance) {
      const f=(distance-a.distanceMeters)/(b.distanceMeters-a.distanceMeters || 1);
      return a[key]+f*(b[key]-a[key]);
    }
  }
  return null;
}
function measurements(samples,map) {
  return map.corners.map(function(corner){
    const selected=samples.filter(function(s){return s.distanceMeters>=corner.start && s.distanceMeters<=corner.end;});
    if(selected.length<3) return null;
    let apex=selected[0];
    for(const s of selected) if(s.speedKmh<apex.speedKmh) apex=s;
    const braking=selected.find(function(s){return s.distanceMeters<=apex.distanceMeters && s.brake>=CONFIG.analysis.brakeThreshold;});
    // Pickup is a rising throttle edge after the minimum, not merely holding gas all corner.
    let pickup=null, released=selected.some(function(s){return s.distanceMeters<=apex.distanceMeters && s.throttle<CONFIG.analysis.throttleThreshold;});
    for(let i=0;i<selected.length;i++) {
      const s=selected[i];
      if(s.throttle<CONFIG.analysis.throttleThreshold) released=true;
      if(released && s.distanceMeters>=apex.distanceMeters && s.throttle>=CONFIG.analysis.throttleThreshold && s.brake<CONFIG.analysis.brakeThreshold) {pickup=s;break;}
    }
    const enter=atDistance(samples,corner.start,"timeSeconds"),exit=atDistance(samples,corner.end,"timeSeconds");
    if(enter===null || exit===null) return null;
    return {name:corner.name,minimumSpeedKmh:apex.speedKmh,brakingMeters:braking?.distanceMeters ?? null,
      throttlePickupMeters:pickup?.distanceMeters ?? null,durationSeconds:exit-enter,observedAt:atDistance(samples,corner.end,"timestampMs")};
  }).filter(Boolean);
}
export function compareLap(lap,reference,map) {
  const corners=measurements(lap.samples,map),baseline=reference ? measurements(reference.samples,map) : [];
  const comparisons=corners.map(function(c){
    const r=baseline.find(function(item){return item.name===c.name;});
    const hasBrake=r && c.brakingMeters!==null && r.brakingMeters!==null;
    // Timing offset comes from the REFERENCE lap's distance/time curve. Current vehicle speed is never used.
    const earlySeconds=hasBrake ? atDistance(reference.samples,r.brakingMeters,"timeSeconds")-atDistance(reference.samples,c.brakingMeters,"timeSeconds") : null;
    return {...c,timeLostSeconds:r ? round(c.durationSeconds-r.durationSeconds) : null,
      brakedEarlyMeters:hasBrake ? round(r.brakingMeters-c.brakingMeters) : null,brakedEarlySeconds:earlySeconds===null ? null : round(earlySeconds),
      minimumSpeedDifferenceKmh:r ? round(c.minimumSpeedKmh-r.minimumSpeedKmh) : null,
      throttlePickupLateMeters:r && c.throttlePickupMeters!==null && r.throttlePickupMeters!==null ? round(c.throttlePickupMeters-r.throttlePickupMeters) : null};
  });
  const losses=comparisons.filter(function(c){return c.timeLostSeconds!==null;}).sort(function(a,b){return b.timeLostSeconds-a.timeLostSeconds;});
  const summary=reference ? "Lap "+lap.lapNumber+": "+round(lap.lapTimeSeconds)+" s versus reference "+reference.id+". "+losses.slice(0,4).map(function(c){
    return c.name+": loss "+c.timeLostSeconds+" s, min speed "+c.minimumSpeedDifferenceKmh+" km/h"+(c.brakedEarlyMeters===null ? ", braking point unavailable" : ", braked "+Math.abs(c.brakedEarlyMeters)+" m "+(c.brakedEarlyMeters>=0?"earlier":"later"));
  }).join("; ") : "Lap "+lap.lapNumber+": "+round(lap.lapTimeSeconds)+" s. First clean reference recorded; comparison starts next lap.";
  return {id:lap.id,lapNumber:lap.lapNumber,lapTimeSeconds:round(lap.lapTimeSeconds),valid:true,startedAt:lap.startedAt,completedAt:lap.completedAt,
    summary:summary,corners:comparisons,comparison:reference ? {referenceId:reference.id,trackVersion:map.version,physicsVersion:lap.physicsVersion,setupId:lap.setupId} : undefined};
}
export class LapAnalyzer {
  constructor(options={}) {this.onLap=options.onLap||function(){};this.onStatus=options.onStatus||function(){};this.onMap=options.onMap||function(){};this.maps=new Map();this.best=new Map();this.reset();}
  reset() {this.previous=null;this.samples=null;this.reasons=new Set();this.lapNumber=0;this.reference=null;this.lastCallouts=new Map();}
  invalidate(reason) {if(this.samples) this.reasons.add(reason);}
  push(sample) {
    if(sample.trackLengthMeters===null){this.previous=null;return;}
    const c=CONFIG.analysis, previous=this.previous;
    if(previous && (sample.sessionId!==previous.sessionId || sample.trackVersion!==previous.trackVersion || sample.physicsVersion!==previous.physicsVersion)) this.reset();
    const prev=this.previous;
    if(prev && sample.timeSeconds<=prev.timeSeconds) {this.reset();this.previous=sample;return;}
    let crossing=false, boundary;
    if(prev) {
      const length=sample.trackLengthMeters,dt=sample.timeSeconds-prev.timeSeconds;
      let delta=sample.distanceMeters-prev.distanceMeters;
      const wrapped=delta < -length/2;
      if(wrapped) delta+=length;
      const possible=Math.max(sample.speedKmh,prev.speedKmh)/3.6*dt*c.maximumTravelFactor+c.positionToleranceMeters;
      if(dt>c.maximumSampleGapSeconds) this.invalidate("telemetry gap/pause");
      if(delta < -c.reverseToleranceMeters) this.invalidate("reverse travel");
      if(Math.abs(delta)>possible) this.invalidate("position jump");
      crossing=wrapped && delta>=0 && delta<=possible;
      if(crossing) {
        const f=(length-prev.distanceMeters)/(delta||1);
        boundary={...sample,distanceMeters:0,normalizedCarPosition:0,timeSeconds:prev.timeSeconds+dt*f,timestampMs:prev.timestampMs+(sample.timestampMs-prev.timestampMs)*f};
        if(this.samples) {
          if(sample.setupId!==this.samples[0].setupId) this.invalidate("fan or trim changed");
          if(sample.lateralOffsetMeters>sample.trackWidthMeters/2+c.trackLimitToleranceMeters) this.invalidate("off track");
          if(sample.airborne) this.invalidate("airborne");
          if(sample.crash) this.invalidate("impact");
          this.samples.push({...boundary,distanceMeters:length,normalizedCarPosition:1});
          this.complete(boundary);
        }
        this.lapNumber++;
        this.samples=[boundary];this.reasons=new Set();
        this.reference=this.best.get(sample.trackId+":"+sample.trackVersion+":"+sample.physicsVersion+":"+sample.setupId)||null;
        this.onStatus("Recording lap "+this.lapNumber+(this.reference ? " against best "+round(this.reference.lapTimeSeconds)+" s" : " · building first reference"));
      }
    }
    if(this.samples) {
      if(sample.setupId!==this.samples[0].setupId) this.invalidate("fan or trim changed");
      if(sample.lateralOffsetMeters>sample.trackWidthMeters/2+c.trackLimitToleranceMeters) this.invalidate("off track");
      if(sample.airborne) this.invalidate("airborne");
      if(sample.crash) this.invalidate("impact");
      if(this.samples.length>=c.maximumLapSamples) this.invalidate("lap too long");
      else this.samples.push(sample);
    } else this.onStatus("Out-lap · cross the start line to begin recording");
    this.previous=sample;
  }
  complete(boundary) {
    const first=this.samples[0],duration=boundary.timeSeconds-first.timeSeconds;
    if(duration<CONFIG.analysis.minimumLapSeconds) this.reasons.add("lap too short");
    if(this.reasons.size) {this.onStatus("Lap ignored: "+Array.from(this.reasons).join(", "));return;}
    const key=first.trackId+":"+first.trackVersion;
    let map=this.maps.get(key);
    if(!map) {map=detectCorners(this.samples,first.trackLengthMeters,first.trackId,first.trackVersion);this.maps.set(key,map);this.onMap(map);}
    if(!map.corners.length) {this.onStatus("No measurable corners detected on this lap");return;}
    const lap={id:first.sessionId+"-lap-"+this.lapNumber,lapNumber:this.lapNumber,lapTimeSeconds:duration,startedAt:first.timestampMs,completedAt:boundary.timestampMs,
      physicsVersion:first.physicsVersion,setupId:first.setupId,samples:this.samples};
    const result=compareLap(lap,this.reference,map);
    const bestKey=first.trackId+":"+first.trackVersion+":"+first.physicsVersion+":"+first.setupId;
    const best=this.best.get(bestKey);
    if(!best || duration<best.lapTimeSeconds) this.best.set(bestKey,lap);
    this.onLap(result);
  }
}
export function telemetryCallouts(sample,last=new Map()) {
  const events=[],c=CONFIG.analysis;
  // ABS/TC activity is measured; it is not proof that a wheel locked or spun.
  const conditions=[['abs_active',sample.absActive],['traction_control',sample.tractionControlActive],['tires_hot',Math.max(sample.tireFL,sample.tireFR,sample.tireRL,sample.tireRR)>c.hotTireC],['tires_cold',sample.speedKmh>c.cornerMinimumSpeedKmh && Math.min(sample.tireFL,sample.tireFR,sample.tireRL,sample.tireRR)<c.coldTireC]];
  for(const [name,active] of conditions) {
    if(active && sample.timeSeconds-(last.get(name)??-Infinity)>=c.calloutCooldownSeconds) {events.push(name);last.set(name,sample.timeSeconds);}
  }
  return events;
}
