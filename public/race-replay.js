import { RaceEngineer } from './coach.js';
import { parseTelemetryCsv } from './shared/race-telemetry.js';
import { LapAnalyzer,telemetryCallouts } from './shared/lap-analysis.js';
const engineer=new RaceEngineer({dataset:'demo'}),status=document.getElementById('replay-status');
const play=document.getElementById('play'),stop=document.getElementById('stop');
let samples=[],index=0,running=false,anchor=0,lastState=null,callouts=new Map();
const laps=[];
const analyzer=new LapAnalyzer({onLap:function(lap){laps.push(lap);engineer.addLapSummary({...lap,source:"replay"});document.getElementById('replay-laps').textContent=laps.map(function(l){return l.summary;}).join('\n\n');}});
function load(text,label) {
  try {
    const rows=parseTelemetryCsv(text);
    if(!rows.length) throw new Error('Recording is empty');
    const first=rows[0];
    if(rows.some(function(s,i){return s.sessionId!==first.sessionId || s.trackId!==first.trackId || (i>0 && s.timeSeconds<=rows[i-1].timeSeconds);})) throw new Error('Use a single session with strictly increasing sample times');
    running=false;analyzer.reset();analyzer.best.clear();analyzer.maps.clear();engineer.reset();laps.length=0;index=0;callouts=new Map();
    const replayId='replay-'+Date.now().toString(36);samples=rows.map(function(s){return {...s,sessionId:replayId};});
    engineer.setTrack(first.trackId);engineer.sessionId=replayId;
    status.textContent=label+' · '+samples.length+' samples · replay/example dataset';play.disabled=false;stop.disabled=true;
    document.getElementById('replay-laps').textContent='No completed laps yet.';
  } catch(error) {status.textContent=error.message;}
}
document.getElementById('file').onchange=async function(event){const f=event.target.files[0];if(f) {if(f.size>15000000){status.textContent='Recording exceeds 15 MB';return;}load(await f.text(),f.name);}};
document.getElementById('sample').onclick=async function(){try{const r=await fetch('/fixtures/race-session.csv');if(!r.ok)throw new Error('Sample unavailable');load(await r.text(),'Synthetic test recording');}catch(e){status.textContent=e.message;}};
play.onclick=function(){if(index>=samples.length)return;running=true;anchor=performance.now()/1000-samples[index].timeSeconds;play.disabled=true;stop.disabled=false;};
stop.onclick=function(){running=false;play.disabled=false;stop.disabled=true;engineer.voice.clear();};
setInterval(function(){
  if(running) {
    const time=performance.now()/1000-anchor;
    while(index<samples.length && samples[index].timeSeconds<=time) {
      const s={...samples[index++],timestampMs:Date.now()};
      // On playback, wall-clock observation stamps permit outcome checks after a shown cue.
      analyzer.push(s);
      lastState={speedKmh:s.speedKmh,steer:s.steer,fansOn:s.fansOn,tankPercent:s.tankPercent,mode:s.mode,airborne:s.airborne,altitude:0,events:telemetryCallouts(s,callouts),goalText:'Replay '+s.trackId};
      engineer.update(lastState,s.throttle,false);
      document.getElementById('replay-state').textContent=JSON.stringify({sample:index,total:samples.length,speedKmh:s.speedKmh,normalizedCarPosition:s.normalizedCarPosition,brake:s.brake,throttle:s.throttle},null,2);
    }
    status.textContent='Playing '+index+'/'+samples.length+' samples · '+laps.length+' completed clean laps';
    if(index===samples.length){running=false;stop.disabled=true;status.textContent+=' · complete; select the file again to restart';}
  } else if(lastState && index>=samples.length) engineer.update({...lastState,speedKmh:0,steer:0,events:[]},0,false);
  else if(lastState) engineer.voice.update(lastState,0,true);
},50);
