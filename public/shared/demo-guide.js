// A measured stunt attempt, shared by the UI and API. Success comes from the game's goal.
export function inferDemo(question) {
  if (!/\b(curl|jump)\b/i.test(question) || !/\b(help|guide|through|learn|teach|do|practice|try)\b/i.test(question)) return null;
  return /\bcurl\b/i.test(question) ? 'reveal-curl' : 'tesla-event';
}
export const DEMOS = {
  'reveal-curl': { name: 'Reveal Curl', steps: {
    setup: 'Select Rocket (3), turn FANS on (F), and line up with the curl. Keep BOOST and LIFT released on the approach.',
    approach: 'Drive straight toward the curl with FANS on. Keep steering centered; use the tires before trying thrusters.',
    climb: 'Stay centered and keep FANS on as the car climbs. Wait until the top before tapping ROLL (Q/E or phone ROLL).',
    top: 'At the top, tap ROLL once to leave the curl. Let the automatic roll finish; avoid extra steering.',
    flight: 'Let the automatic roll finish and aim for the green zone behind the curl. Release BOOST; watch your landing.',
    landed: 'You have touched down. Drive into the green zone behind the curl; a barrel roll is required for this goal.',
    complete: 'The game confirmed the curl goal. Review the attempt and choose one improvement.',
    failed: 'The attempt had an impact or flip. Reset (R or phone RESET) to retry; explain the measured mistake first.'
  } },
  'tesla-event': { name: 'Reveal Jump', steps: {
    setup: 'Select Rocket (3) for LIFT. Line up with the ramp, keep steering centered, and build speed on the approach.',
    approach: 'Drive straight at the launch ramp. Be ready for LIFT (Shift or phone LIFT) at takeoff; save air until then.',
    climb: 'The car is on the ramp. Use a short LIFT input at launch to add clearance over the lineup; keep it straight.',
    flight: 'Use only the LIFT needed for clearance, then release it to descend toward the landing ramp. ROLL is optional.',
    landed: 'Touchdown recorded. Continue straight to the green zone beyond the landing ramp.',
    complete: 'The game confirmed the jump goal. Review the attempt and choose one improvement.',
    failed: 'The attempt had an impact or flip. Reset (R or phone RESET) to retry; explain the measured mistake first.'
  } }
};
export class DemoGuide {
  constructor(trackId) { this.trackId=trackId; this.attempts=[]; this.number=0; this.reset(); }
  reset() {
    if(this.number && this.latest) this.attempts.push(this.summary());
    this.attempts=this.attempts.slice(-3); this.number++; this.phase='setup'; this.issues=[];
    this.maxHeight=0; this.takeoffSpeed=null; this.rolled=false; this.wasAirborne=false; this.latest=null;
  }
  summary() { return { attempt:this.number, phase:this.phase, issues:[...this.issues], maxHeight:this.maxHeight, takeoffSpeed:this.takeoffSpeed, rolled:this.rolled }; }
  update(state) {
    const t=state.stunt;
    if(!t || t.trackId!==this.trackId || t.source!=='live' || Date.now()-t.capturedAt>5000) return false;
    const before=JSON.stringify([this.phase,this.issues]); this.latest=t;
    this.maxHeight=Math.max(this.maxHeight,t.y);
    const issue=(text)=>{ if(!this.issues.includes(text)) this.issues.push(text); };
    if(state.events.includes('barrel_roll')) this.rolled=true;
    if(t.airborne && !this.wasAirborne && t.z>0) this.takeoffSpeed=state.speedKmh;
    this.wasAirborne=t.airborne;
    if(t.goalDone) this.phase='complete';
    else if(state.events.some(e=>['crash','flip','goal_failed'].includes(e))) this.phase='failed';
    else if(!['complete','failed'].includes(this.phase)) {
      if(state.events.includes('landing') && this.maxHeight>2) this.phase='landed';
      else if(this.phase!=='landed') {
        if(this.trackId==='reveal-curl') {
          if(this.rolled && t.airborne) this.phase='flight';
          else if(t.y>15 && t.upY<0) this.phase='top';
          else if(t.y>2 && t.z>15) this.phase='climb';
          else if(state.speedKmh>5 || t.z>-100) this.phase='approach';
        } else {
          if(t.airborne && t.z>15) this.phase='flight';
          else if(t.y>1 && t.z>15) this.phase='climb';
          else if(state.speedKmh>5 || t.z>-110) this.phase='approach';
        }
      }
      if(this.trackId==='reveal-curl' && ['climb','top'].includes(this.phase) && !state.fansOn) issue('Fans were off on the curl.');
      if(this.trackId==='reveal-curl' && t.roll!==0 && this.maxHeight<12) issue('ROLL was pressed before reaching the top of the curl.');
      if(t.z>0 && Math.abs(t.x)>4.5 && this.phase!=='landed') issue('Car moved outside the ramp/curl center corridor.');
      if(t.lift && t.z<0) issue('LIFT was used before reaching the ramp/curl.');
      if(t.gas>.3 && t.brake>.3) issue('Gas and brake were held together.');
    }
    this.issues=this.issues.slice(-6);
    return before!==JSON.stringify([this.phase,this.issues]);
  }
  context() { return { source:'live',trackId:this.trackId,capturedAt:this.latest?.capturedAt || Date.now(),name:DEMOS[this.trackId].name,phase:this.phase,instruction:DEMOS[this.trackId].steps[this.phase],...this.summary(),previousAttempts:this.attempts,inputs:this.latest }; }
}
export function cleanStunt(raw, trackId, now=Date.now()) {
  if(!raw || raw.source!=='live' || raw.trackId!==trackId || !DEMOS[trackId] || !Number.isFinite(raw.capturedAt) || Math.abs(now-raw.capturedAt)>5000) return null;
  const result={source:'live',trackId,capturedAt:raw.capturedAt};
  for(const [key,min,max] of [['x',-2000,2000],['y',-100,1000],['z',-2000,2000],['upY',-1,1],['gas',0,1],['brake',0,1],['steer',-1,1],['roll',-1,1]]) {
    if(!Number.isFinite(raw[key]) || raw[key]<min || raw[key]>max) return null;
    result[key]=raw[key];
  }
  for(const key of ['airborne','goalDone','thrust','lift','rolling']) result[key]=raw[key]===true;
  return result;
}
export function cleanGuide(raw, trackId) {
  const inputs=cleanStunt(raw?.inputs,trackId);
  if(!inputs || raw.source!=='live' || raw.trackId!==trackId || !DEMOS[trackId]?.steps[raw.phase]) return null;
  const summary=(item)=>({attempt:Math.max(1,Math.min(1000,Number(item.attempt)||1)),phase:String(item.phase).slice(0,20),issues:(Array.isArray(item.issues)?item.issues:[]).slice(-6).map(s=>String(s).slice(0,120)),maxHeight:Math.max(0,Math.min(1000,Number(item.maxHeight)||0)),takeoffSpeed:Number.isFinite(item.takeoffSpeed)?Math.max(0,Math.min(500,item.takeoffSpeed)):null,rolled:item.rolled===true});
  return {...summary(raw),source:'live',trackId,name:DEMOS[trackId].name,phase:raw.phase,instruction:DEMOS[trackId].steps[raw.phase],capturedAt:inputs.capturedAt,inputs,previousAttempts:(Array.isArray(raw.previousAttempts)?raw.previousAttempts:[]).slice(-3).map(summary)};
}
