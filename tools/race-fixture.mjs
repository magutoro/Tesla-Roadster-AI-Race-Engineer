// Deterministic synthetic input, never presented as measured driving.
import { telemetryCsv } from '../public/shared/race-telemetry.js';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export function raceFixture(options={}) {
  const samples=[];
  let time=0,sequence=0;
  const base=Date.now()-3600000;
  function add(distance,lap) {
    const corner=(distance>=200 && distance<=270)||(distance>=600 && distance<=670);
    const loss=lap>0 && corner;
    const speed=corner ? (loss ? 64 : 80) : 120;
    time+=5/(speed/3.6);
    const brakeStart=lap>0 ? 145 : 170;
    const brake=(distance>=brakeStart && distance<220)||(distance>=brakeStart+400 && distance<620);
    samples.push({sessionId:'synthetic-recording',trackId:'synthetic-circuit',trackVersion:'synthetic-track-v1',physicsVersion:'synthetic-physics-v1',setupId:'performance-fans-on',mode:'performance',sequence:sequence++,timestampMs:base+time*1000,timeSeconds:time,lapNumber:Math.max(0,lap+1),lapTimeSeconds:distance/(speed/3.6),distanceMeters:distance,trackLengthMeters:1000,normalizedCarPosition:distance/1000,lateralOffsetMeters:0,trackWidthMeters:14,speedKmh:speed,throttle:brake || (corner && distance%400<245) ? 0 : 0.8,brake:brake?0.6:0,steer:corner?0.4:0,steerDegrees:corner?8:0,gLat:corner?0.8:0,gLong:brake?-0.5:0,airborne:false,fansOn:true,tankPercent:100,absActive:false,tractionControlActive:false,tireFL:75,tireFR:75,tireRL:75,tireRR:75,crash:false,gear:null,rpm:null});
  }
  for(let d=950;d<1000;d+=5) add(d,-1);
  for(let lap=0;lap<(options.laps||3);lap++) for(let d=0;d<1000;d+=5) add(d,lap);
  add(0,3);
  return samples;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  await writeFile(new URL('../fixtures/race-session.csv',import.meta.url),telemetryCsv(raceFixture()));
  console.log('Wrote labeled synthetic race-session.csv');
}
