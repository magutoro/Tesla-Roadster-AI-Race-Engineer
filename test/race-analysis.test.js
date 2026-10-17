import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { raceFixture } from '../tools/race-fixture.mjs';
import { telemetryCsv,parseTelemetryCsv,cleanTelemetrySample,TrackPosition } from '../public/shared/race-telemetry.js';
import { LapAnalyzer,telemetryCallouts,detectCorners } from '../public/shared/lap-analysis.js';
import { cleanLap } from '../server/memory.js';
import { chooseFocus } from '../server/coaching-loop.js';
import { installRaceDataRoutes } from '../server/race-data.js';
test('CSV round trip preserves the actual telemetry fields and rejects malformed replay',function(){
 const rows=raceFixture();assert.deepEqual(parseTelemetryCsv(telemetryCsv(rows)),rows);
 assert.throws(function(){parseTelemetryCsv('speed\n12');});
 assert.throws(function(){cleanTelemetrySample({...rows[0],gear:1});});
 assert.throws(function(){cleanTelemetrySample({...rows[0],trackId:'../private'});});
 assert.throws(function(){cleanTelemetrySample({...rows[0],normalizedCarPosition:1.2});});
});
test('track projection starts at the actual finish line and distinguishes bridge elevation',function(){
 const points=[{x:0,y:0,z:0},{x:10,y:0,z:0},{x:10,y:8,z:0},{x:0,y:8,z:0}];
 const p=new TrackPosition({samples:points.map(function(center){return {center:center};}),count:4,width:14,checkpoints:[{position:points[1]}]});
 assert.equal(p.project(points[1]).distanceMeters,0);
 assert.equal(p.project({x:5,y:8,z:0}).lateralOffsetMeters,0);
 assert.ok(p.project({x:5,y:8,z:0}).normalizedCarPosition>0.2);
 assert.notEqual(p.project({x:5,y:0,z:0}).normalizedCarPosition,p.project({x:5,y:8,z:0}).normalizedCarPosition);
});
test('recorded laps flow through real analysis, validation and measured coaching',function(){
 const laps=[],maps=[];const analyzer=new LapAnalyzer({onLap:function(lap){laps.push(cleanLap(lap));},onMap:function(m){maps.push(m);}});
 for(const row of raceFixture()) analyzer.push(row);
 assert.equal(laps.length,3);assert.equal(maps.length,1);assert.equal(maps[0].corners.length,2);
 assert.equal(laps[0].comparison,null);assert.ok(laps[1].comparison);
 assert.equal(laps[1].comparison.referenceId,laps[0].id);
 assert.equal(laps[2].comparison.referenceId,laps[0].id);
 assert.equal(laps[1].corners[0].brakedEarlyMeters,25);
 assert.ok(laps[1].corners[0].brakedEarlySeconds>0);
 assert.ok(laps[1].corners[0].timeLostSeconds>0);
 assert.equal(laps[1].corners[0].minimumSpeedDifferenceKmh,-16);
 const focus=chooseFocus(laps.toReversed());assert.ok(focus);assert.equal(focus.evidenceLapIds.length,2);assert.ok(focus.actionSeconds<=0.3);
 assert.equal(focus.actionDirection,'later');
});
test('out-laps, cuts, impacts, setup changes, gaps, reverse and teleports cannot establish references',function(){
 for(const kind of ['offtrack','airborne','crash','setup','gap','reverse','teleport']) {
  const rows=raceFixture({laps:1}),laps=[];const analyzer=new LapAnalyzer({onLap:function(l){laps.push(l);}});
  const changed=rows.map(function(row){return {...row};});
  const i=80;
  if(kind==='offtrack') changed[i].lateralOffsetMeters=30;
  if(kind==='airborne') changed[i].airborne=true;
  if(kind==='crash') changed[i].crash=true;
  if(kind==='setup') changed[i].setupId='rocket-fans-off';
  if(kind==='gap') changed.splice(i,8);
  if(kind==='reverse') changed[i].distanceMeters=changed[i-1].distanceMeters-10;
  if(kind==='teleport') changed[i].distanceMeters+=300;
  for(const row of changed) analyzer.push(row);
  assert.equal(laps.length,0,kind);
 }
 const laps=[];const a=new LapAnalyzer({onLap:function(l){laps.push(l);}});for(const r of raceFixture().slice(40,150)) a.push(r);assert.equal(laps.length,0);
});
test('ABS/traction control callouts use measured assistance flags and a cooldown',function(){
 const s={...raceFixture()[0],absActive:true,tractionControlActive:true};const seen=new Map();
 assert.deepEqual(telemetryCallouts(s,seen),['abs_active','traction_control']);assert.deepEqual(telemetryCallouts(s,seen),[]);
 assert.ok(telemetryCallouts({...s,timeSeconds:s.timeSeconds+31},seen).includes('abs_active'));
});
test('disk recording validates samples and writes a replayable CSV without exposing paths',async function(){
 const root=await mkdtemp(path.join(os.tmpdir(),'roadster-recording-'));const handlers={};
 installRaceDataRoutes({post:function(route,handler){handlers[route]=handler;},get:function(route,handler){handlers["GET "+route]=handler;}},root);
 let body,status=200;const res={status:function(value){status=value;return this;},json:function(value){body=value;}};
 try{
  const samples=raceFixture().slice(0,20);await handlers['/api/race-data/samples']({body:{samples:samples}},res);
  assert.equal(body.stored,20);assert.equal(status,200);
  const file=body.file;
  assert.deepEqual(parseTelemetryCsv(await readFile(path.join(root,file),'utf8')),samples);
  await handlers['/api/race-data/samples']({body:{samples:samples}},res);
  assert.equal(body.stored,0);
  assert.deepEqual(parseTelemetryCsv(await readFile(path.join(root,file),'utf8')),samples);
  await handlers['/api/race-data/samples']({body:{samples:[{...samples[0],trackId:'../secrets'}]}},res);assert.equal(status,400);
  status=200;
  const map=detectCorners(raceFixture().slice(10,210),1000,'synthetic-circuit','synthetic-track-v1');
  await handlers['/api/race-data/map']({body:map},res);assert.equal(body.stored,true);
  await handlers['GET /api/race-data/map']({query:{trackId:map.trackId,trackVersion:map.trackVersion,analysisVersion:map.analysisVersion}},res);
  assert.deepEqual(body,map);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a new best is used only on the next lap, without rewriting earlier references',function(){
 const rows=raceFixture({laps:4}),laps=[];let time=0;
 for(const row of rows) {
  if(row.lapNumber===3) row.speedKmh*=1.4;
  time+=5/(row.speedKmh/3.6);row.timeSeconds=time;row.timestampMs=Date.now()-3600000+time*1000;
 }
 const analyzer=new LapAnalyzer({onLap:function(l){laps.push(l);}});
 for(const row of rows) analyzer.push(row);
 assert.equal(laps.length,4);
 assert.equal(laps[1].comparison.referenceId,laps[0].id);
 assert.equal(laps[2].comparison.referenceId,laps[0].id);
 assert.equal(laps[3].comparison.referenceId,laps[2].id);
});
