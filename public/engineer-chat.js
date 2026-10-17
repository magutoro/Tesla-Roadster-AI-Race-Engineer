import { JOURNAL_KEY } from './shared/engineer-journal.js';
const sessions=document.querySelector('#sessions');
const thread=document.querySelector('#thread');
const inputs=document.querySelector('#inputs');
const status=document.querySelector('#status');
let threads=[];
function read() {
  try { threads=JSON.parse(localStorage.getItem(JOURNAL_KEY)||'[]'); if(!Array.isArray(threads)) threads=[]; }
  catch {status.textContent='Browser storage is unavailable.';threads=[];}
  const selected=sessions.value;
  sessions.replaceChildren();
  for(const session of [...threads].reverse()) {
    const option=document.createElement('option'); option.value=session.id;
    option.textContent=new Date(session.updatedAt).toLocaleString()+' · '+session.dataset;
    sessions.appendChild(option);
  }
  if(threads.some(t=>t.id===selected)) sessions.value=selected;
  render();
}
function render() {
  const expanded=new Set(Array.from(thread.querySelectorAll("article details[open]")).map(detail=>detail.parentElement.dataset.key));
  thread.replaceChildren();
  const session=threads.find(t=>t.id===sessions.value);
  if(!session) {status.textContent='No conversations saved yet. Turn Engineer on and ask a question in the simulator.';return;}
  status.textContent='Local browser history · '+session.rows.length+' records · live updates';
  for(const row of session.rows) {
    if(row.role==='input' && !inputs.checked) continue;
    const article=document.createElement('article');article.className=row.role;article.dataset.key=row.at+'-'+row.role;
    const heading=document.createElement('small');
    heading.textContent=({user:'You',engineer:'Engineer',drive:'Attempt',input:'Inputs'}[row.role]||row.role)+' · '+new Date(row.at).toLocaleTimeString()+' · '+(row.trackId||'')+(row.source?' · '+row.source:'');
    const text=document.createElement('p');text.textContent=row.text;
    article.append(heading,text);
    if(row.inputs) {
      const t=row.inputs; const detail=document.createElement('details');detail.open=expanded.has(article.dataset.key);
      const summary=document.createElement('summary');summary.textContent='Recorded controls & car state';
      const body=document.createElement('p');
      body.textContent='Gas '+Math.round(t.gas*100)+'% · brake '+Math.round(t.brake*100)+'% · steer '+Math.round(t.steer*100)+'% · BOOST '+(t.thrust?'on':'off')+' · LIFT '+(t.lift?'on':'off')+' · ROLL '+t.roll+' · '+(t.airborne?'airborne':'grounded')+' · position '+[t.x,t.y,t.z].map(n=>Number(n).toFixed(1)).join(', ')+' m'+(row.speedKmh!==undefined?' · '+row.speedKmh+' km/h':'')+(row.fansOn!==undefined?' · FANS '+(row.fansOn?'on':'off'):'');
      detail.append(summary,body);article.appendChild(detail);
    }
    if(row.attempt) {const p=document.createElement('p');p.textContent='Attempt '+row.attempt.attempt+' · '+row.attempt.phase+' · '+(row.attempt.issues.join(' ')||'No recorded control issues.');article.appendChild(p);}
    thread.appendChild(article);
  }
}
sessions.addEventListener('change',render);inputs.addEventListener('change',render);
window.addEventListener('storage',read);
document.querySelector('#download').addEventListener('click',()=>{
  const session=threads.find(t=>t.id===sessions.value);if(!session)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(session,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='engineer-'+session.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
read();
