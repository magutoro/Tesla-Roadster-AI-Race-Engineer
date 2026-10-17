// Immediate observations from this run, independent of reference laps, Neo4j and AI credits.
import { CONFIG } from '../config.js';
export function liveSnapshot(sample, invalidReasons=[]) {
  return {source:'live',circuit:sample.trackLengthMeters!==null,capturedAt:sample.timestampMs,trackId:sample.trackId,speedKmh:Math.round(sample.speedKmh),throttle:sample.throttle,brake:sample.brake,
    steerDegrees:sample.steerDegrees,gLat:sample.gLat,gLong:sample.gLong,normalizedCarPosition:sample.normalizedCarPosition,
    offTrack:sample.trackLengthMeters!==null && sample.lateralOffsetMeters>sample.trackWidthMeters/2+CONFIG.analysis.trackLimitToleranceMeters,
    tireMinC:Math.round(Math.min(sample.tireFL,sample.tireFR,sample.tireRL,sample.tireRR)),tireMaxC:Math.round(Math.max(sample.tireFL,sample.tireFR,sample.tireRL,sample.tireRR)),
    absActive:sample.absActive,tractionControlActive:sample.tractionControlActive,lapNumber:sample.lapNumber,lapValidSoFar:sample.trackLengthMeters!==null && invalidReasons.length===0,invalidReasons:invalidReasons.slice(0,8)};
}
export class LiveDrivingCoach {
  constructor(){this.reset();}
  reset(){this.turn=null;this.lastTip=-Infinity;this.lastSnapshot=null;}
  update(sample,lang='en') {
    const c=CONFIG.liveCoaching,now=sample.timeSeconds;
    if(this.lastSnapshot && (sample.sessionId!==this.lastSnapshot.sessionId || now<this.lastSnapshot.timeSeconds)) this.reset();
    this.lastSnapshot=sample;
    const turning=Math.abs(sample.steerDegrees)>=CONFIG.analysis.cornerSteerDegrees || Math.abs(sample.gLat)>=CONFIG.analysis.cornerLateralG;
    if(sample.speedKmh<c.minimumSpeedKmh || sample.airborne){this.turn=null;return null;}
    if(turning){
      if(!this.turn) this.turn={startedAt:now,minimum:sample.speedKmh,peakG:0,brake:0,fansOff:false,lastTurningAt:now};
      this.turn.minimum=Math.min(this.turn.minimum,sample.speedKmh);this.turn.peakG=Math.max(this.turn.peakG,Math.abs(sample.gLat));
      this.turn.brake=Math.max(this.turn.brake,sample.brake);this.turn.fansOff ||= !sample.fansOn;this.turn.lastTurningAt=now;
    }
    if(now-this.lastTip<c.intervalSeconds) return null;
    const ja=lang==='ja';let text,kind,evidence;
    if(sample.trackLengthMeters!==null && sample.lateralOffsetMeters>sample.trackWidthMeters/2+CONFIG.analysis.trackLimitToleranceMeters){
      text=ja?'コース外です。アクセルを緩め、ゆっくりコースに戻りましょう。':'You are off track. Ease off the throttle and rejoin gently.';kind='off_track';
    } else if(this.turn && !turning && now-this.turn.lastTurningAt>=c.exitSettleSeconds){
      const t=this.turn;this.turn=null;
      if(now-t.startedAt<c.minimumTurnSeconds) return null;
      const speed=Math.round(t.minimum),g=t.peakG.toFixed(1),brake=Math.round(t.brake*100);
      evidence={minimumSpeedKmh:speed,peakLateralG:Number(g),peakBrakePercent:brake,fansOff:t.fansOff,durationSeconds:Math.round((now-t.startedAt)*10)/10};
      text=ja?'今の旋回の最低速度は'+speed+' km/h、横Gは最大'+g+'。':'That turn: minimum '+speed+' kilometres per hour, peak lateral load '+g+' G.';
      if(t.fansOff) text+=ja?' ファンがオフでした。':' Your fans were off; switch them on for more grip.';
      else if(brake>0) text+=ja?' 最大ブレーキは'+brake+'パーセント。':' Peak brake input was '+brake+' percent.';
      kind='turn_observation';
    } else if(sample.brake>=c.overlapThreshold && sample.throttle>=c.overlapThreshold){
      text=ja?'アクセルとブレーキを同時に踏んでいます。':'You are applying throttle and brake together. Release the throttle while slowing down.';kind='pedal_overlap';
    }
    if(!text) return null;
    this.lastTip=now;
    return {text:text,lang:lang,source:'live',kind:kind,trackId:sample.trackId,evidence:evidence||{},capturedAt:sample.timestampMs};
  }
}
export function cleanLiveSnapshot(raw,now=Date.now()) {
  if(!raw || raw.source!=='live' || !Number.isFinite(raw.capturedAt) || now-raw.capturedAt>CONFIG.liveCoaching.maximumAgeMs || raw.capturedAt-now>5000) return null;
  if(typeof raw.trackId!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(raw.trackId)) return null;
  const result={source:'live',capturedAt:raw.capturedAt,trackId:raw.trackId};
  const limits={speedKmh:[0,1000],throttle:[0,1],brake:[0,1],steerDegrees:[-90,90],gLat:[-100,100],gLong:[-100,100],normalizedCarPosition:[0,1],tireMinC:[-100,1000],tireMaxC:[-100,1000],lapNumber:[0,100000]};
  for(const [key,[min,max]] of Object.entries(limits)){if(key==="normalizedCarPosition" && raw[key]===null){result[key]=null;continue;}if(!Number.isFinite(raw[key]) || raw[key]<min || raw[key]>max)return null;result[key]=raw[key];}
  for(const key of ['offTrack','absActive','tractionControlActive','lapValidSoFar','circuit'])result[key]=raw[key]===true;
  result.invalidReasons=(Array.isArray(raw.invalidReasons)?raw.invalidReasons:[]).filter(function(s){return typeof s==='string';}).slice(0,8).map(function(s){return s.slice(0,60);});
  return result;
}


export function cleanLiveObservations(raw,trackId,now=Date.now()) {
  const observations=[];
  for(const item of Array.isArray(raw)?raw.slice(-CONFIG.coach.maximumObservations):[]) {
    if(item?.source!=="live" || item.trackId!==trackId || !["turn_observation","pedal_overlap","off_track"].includes(item.kind) || !Number.isFinite(item.capturedAt) || now-item.capturedAt>CONFIG.coach.observationLifetimeMs || item.capturedAt-now>5000) continue;
    const evidence={};
    for(const [key,max] of Object.entries({minimumSpeedKmh:1000,peakLateralG:100,peakBrakePercent:100,durationSeconds:600})) {
      const value=item.evidence?.[key];
      if(Number.isFinite(value) && value>=0 && value<=max) evidence[key]=value;
    }
    if(typeof item.evidence?.fansOff==="boolean") evidence.fansOff=item.evidence.fansOff;
    observations.push({source:"live",kind:item.kind,trackId:trackId,capturedAt:item.capturedAt,evidence:evidence});
  }
  return observations;
}
