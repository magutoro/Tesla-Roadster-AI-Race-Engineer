import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoGuide,inferDemo,cleanGuide} from '../public/shared/demo-guide.js';
import {EngineerJournal,JOURNAL_KEY} from '../public/shared/engineer-journal.js';
import {cleanCoachRequest} from '../server/ai.js';
const sample=(trackId,changes={},events=[])=>({speedKmh:50,steer:0,mode:'rocket',fansOn:true,tankPercent:90,events,stunt:{source:'live',trackId,capturedAt:Date.now(),x:0,y:0,z:-110,upY:1,gas:.5,brake:0,steer:0,thrust:false,lift:false,roll:0,rolling:false,airborne:false,goalDone:false,...changes}});
test('explicit Curl and Jump requests choose distinct scenarios',()=>{
  assert.equal(inferDemo('Take me through how to do the reveal jump'),'tesla-event');
  assert.equal(inferDemo('Help me do the reveal curl'),'reveal-curl');
  assert.equal(inferDemo('What is my jump height?'),null);
});
test('curl phases use measured orientation and inputs; only the game confirms success',()=>{
  const guide=new DemoGuide('reveal-curl');
  const climb=sample('reveal-curl',{y:8,z:28,upY:.1});climb.fansOn=false;
  guide.update(climb);assert.equal(guide.phase,'climb');assert.match(guide.issues.join(),/Fans were off/);
  guide.update(sample('reveal-curl',{y:20,z:20,upY:-1}));assert.equal(guide.phase,'top');
  guide.update(sample('reveal-curl',{y:22,z:10,airborne:true,roll:1},['barrel_roll']));assert.equal(guide.phase,'flight');
  guide.update(sample('reveal-curl',{y:0,z:-35},['landing']));assert.equal(guide.phase,'landed');
  assert.notEqual(guide.phase,'complete','being in the goal area alone cannot invent success');
  guide.update(sample('reveal-curl',{y:0,z:-35,goalDone:true}));assert.equal(guide.phase,'complete');
  guide.reset();assert.equal(guide.number,2);assert.equal(guide.phase,'setup');assert.equal(guide.attempts[0].phase,'complete');
  assert.match(guide.context().previousAttempts[0].issues.join(),/Fans were off/);
});
test('jump records early lift and takeoff speed, failure survives reset without requiring a roll',()=>{
  const guide=new DemoGuide('tesla-event');
  guide.update(sample('tesla-event',{lift:true}));assert.match(guide.issues.join(),/before reaching/);
  guide.update(sample('tesla-event',{z:35,y:4,airborne:true,lift:true}));assert.equal(guide.phase,'flight');assert.equal(guide.takeoffSpeed,50);
  guide.update(sample('tesla-event',{z:75,y:0},['crash']));assert.equal(guide.phase,'failed');
  guide.reset();assert.equal(guide.attempts[0].phase,'failed');
  guide.update(sample('tesla-event',{z:175,goalDone:true}));assert.equal(guide.phase,'complete');assert.equal(guide.rolled,false);
});
test('API rejects stale, replay and cross-track guide context; keeps fresh measured controls',()=>{
  const state=sample('tesla-event');const guide=new DemoGuide('tesla-event');guide.update(state);
  const body={state,guide:guide.context(),memory:{enabled:true,scope:{driverId:'driver',sessionId:'session',trackId:'tesla-event',mode:'rocket',dataset:'live'}}};
  const clean=cleanCoachRequest(body);assert.equal(clean.guide.inputs.gas,.5);
  assert.equal(cleanGuide({...guide.context(),inputs:{...state.stunt,capturedAt:Date.now()-10000}},'tesla-event'),null);
  assert.equal(cleanGuide({...guide.context(),inputs:{...state.stunt,source:'demo'}},'tesla-event'),null);
  assert.equal(cleanGuide(guide.context(),'reveal-curl'),null);
});
test('chat and input records survive a new instance and remain bounded; storage failures are visible',()=>{
  const data=new Map();const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  const first=new EngineerJournal(storage,'session-1');first.append('user','Teach me the jump');first.append('input','Driving inputs',{inputs:sample('tesla-event').stunt});first.append('engineer','Line up straight.');
  const second=new EngineerJournal(storage,'session-2');second.append('user','What went wrong?');
  const threads=JSON.parse(storage.getItem(JOURNAL_KEY));assert.equal(threads.length,2);assert.equal(threads[0].rows[1].inputs.gas,.5);assert.equal(threads[0].rows[2].text,'Line up straight.');
  for(let i=0;i<610;i++) second.append('input',String(i));
  assert.equal(JSON.parse(storage.getItem(JOURNAL_KEY))[1].rows.length,600);
  const unavailable=new EngineerJournal({getItem(){throw Error('blocked');}},'blocked');unavailable.append('user','hello');assert.equal(unavailable.failed,true);
});

test('stunt voice can play during flight instead of silently waiting for a straight', async()=>{
  const {EngineerVoice}=await import('../public/voice.js');
  let spoken='';
  globalThis.window={speechSynthesis:{cancel(){},getVoices(){return [];},speak(u){spoken=u.text;}}};
  globalThis.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  try {
    const voice=new EngineerVoice(()=>{},()=>{});voice.setEnabled(true);
    voice.queue({text:'Airborne. Watch the landing.',lang:'en',source:'guide'});
    voice.update({speedKmh:80,steer:.5,airborne:true,guidedDemo:true},0,false);
    assert.equal(spoken,'Airborne. Watch the landing.');
    voice.setEnabled(false);
  } finally {delete globalThis.window;delete globalThis.SpeechSynthesisUtterance;}
});
