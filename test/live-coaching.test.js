import test from 'node:test';
import assert from 'node:assert/strict';
import {raceFixture} from '../tools/race-fixture.mjs';
import {LiveDrivingCoach,liveSnapshot,cleanLiveSnapshot} from '../public/shared/live-coaching.js';
import {RaceMemory,cleanLap,cleanScopedLap,resolvePracticeContext} from '../server/memory.js';
import {cleanCoachRequest} from '../server/ai.js';
import {MEMORY_DEMO_LAPS} from '../public/shared/memory-demo.js';
import {SAMPLE_STATE} from '../public/shared/protocol.js';
const scope={dataset:'live',driverId:'driver',sessionId:'session',trackId:'synthetic-circuit',mode:'performance'};
test('live turn observations use current measurements without needing any completed lap',function(){
 const coach=new LiveDrivingCoach(),base={...raceFixture()[0],speedKmh:90,fansOn:false};let tip;
 for(let i=0;i<20;i++) coach.update({...base,timeSeconds:i/10,steerDegrees:6,gLat:1.2,speedKmh:90-i},'en');
 for(let i=20;i<30;i++) tip=coach.update({...base,timeSeconds:i/10,steerDegrees:0,gLat:0},'en')||tip;
 assert.equal(tip.source,'live');assert.match(tip.text,/71 kilometres/);assert.match(tip.text,/1.2 G/);assert.match(tip.text,/fans were off/);
 assert.equal(coach.update({...base,timeSeconds:3,lateralOffsetMeters:20},'en'),null,'cooldown prevents chatter');
 const off=coach.update({...base,timeSeconds:12,lateralOffsetMeters:20},'en');assert.match(off.text,/off track/);
});
test('AI gets bounded fresh live telemetry and cannot mistake it for replay evidence',function(){
 const raw=liveSnapshot({...raceFixture()[0],timestampMs:Date.now()},['off track']);
 assert.ok(cleanLiveSnapshot(raw));assert.equal(cleanLiveSnapshot({...raw,capturedAt:Date.now()-6000}),null);
 assert.equal(cleanLiveSnapshot({...raw,source:'demo'}),null);
 const live=cleanCoachRequest({state:{...SAMPLE_STATE,mode:'performance',telemetry:raw},memory:{enabled:true,scope}});
 assert.equal(live.state.telemetry.source,'live');assert.equal(live.state.telemetry.brake,raw.brake);
 const demo=cleanCoachRequest({state:{...SAMPLE_STATE,mode:'performance',telemetry:raw},memory:{enabled:true,scope:{...scope,dataset:'demo'}}});
 assert.equal(demo.state.telemetry,undefined);
});
test('example/replay laps are rejected at live storage, AI and local fallback boundaries',async function(){
 const example=MEMORY_DEMO_LAPS[0];
 assert.throws(()=>cleanScopedLap(example,scope),/cannot enter live/);
 assert.throws(()=>cleanScopedLap({...example,source:'replay'},scope),/cannot enter live/);
 assert.throws(()=>cleanCoachRequest({state:{...SAMPLE_STATE,mode:'performance'},memory:{enabled:true,scope},laps:[example]}),/cannot enter live/);
 await assert.rejects(resolvePracticeContext(null,scope,null,[example]),/cannot enter live/);
 assert.equal(cleanScopedLap(example,{...scope,dataset:'demo'}).source,'demo');
});

test('direct graph writes also reject demos in live memory and baseline laps survive repeated validation',async function(){
 const memory=new RaceMemory({env:{}});
 await assert.rejects(memory.saveLap(scope,MEMORY_DEMO_LAPS[0]),/cannot enter live/);
 const baseline=cleanLap({id:'baseline',source:'live',summary:'First reference',valid:true,corners:[]});
 assert.equal(cleanScopedLap(baseline,scope).comparison,null);
 const local=await resolvePracticeContext(null,scope,null,[baseline]);
 assert.equal(local.status,'not_configured');
});

test('API turn context excludes stale and wrong-track observations and never includes scripted prose',function(){
 const raw=liveSnapshot({...raceFixture()[0],timestampMs:Date.now()});
 const item={source:'live',trackId:scope.trackId,kind:'turn_observation',capturedAt:Date.now(),text:'Do not transmit scripted advice',evidence:{minimumSpeedKmh:63,peakLateralG:1.2,peakBrakePercent:70,fansOff:true}};
 const request=cleanCoachRequest({state:{...SAMPLE_STATE,mode:'performance',telemetry:raw},memory:{enabled:true,scope},explain:true,observations:[{...item,capturedAt:Date.now()-40000},{...item,trackId:'other'},item]});
 assert.equal(request.observations.length,1);assert.equal(request.observations[0].evidence.minimumSpeedKmh,63);
 assert.equal(JSON.stringify(request.observations).includes('scripted advice'),false);assert.equal(request.explain,true);
});

test('non-circuit Roadster scenarios preserve real telemetry without inventing track progress',async function(){
 const {cleanTelemetrySample,parseTelemetryCsv,telemetryCsv}=await import('../public/shared/race-telemetry.js');
 const sample={...raceFixture()[0],trackId:'reveal-curl',timestampMs:Date.now(),distanceMeters:null,trackLengthMeters:null,normalizedCarPosition:null,lateralOffsetMeters:null,trackWidthMeters:null,lapNumber:0,lapTimeSeconds:0};
 assert.deepEqual(parseTelemetryCsv(telemetryCsv([sample])),[sample]);
 assert.throws(()=>cleanTelemetrySample({...sample,normalizedCarPosition:0.5}),/Incomplete track/);
 const snapshot=cleanLiveSnapshot(liveSnapshot(sample));assert.equal(snapshot.circuit,false);assert.equal(snapshot.normalizedCarPosition,null);assert.equal(snapshot.offTrack,false);
 const request=cleanCoachRequest({state:{...SAMPLE_STATE,mode:'performance',telemetry:snapshot},memory:{enabled:true,scope:{...scope,trackId:'reveal-curl'}}});
 assert.equal(request.state.telemetry.circuit,false);assert.equal(request.state.telemetry.tireMinC,75);
});
