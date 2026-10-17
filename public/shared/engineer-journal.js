// Bounded browser-local chat history. Raw 10 Hz telemetry is saved separately by RaceSession.
export const JOURNAL_KEY='roadster-engineer-threads-v1';
export class EngineerJournal {
  constructor(storage,id,dataset='live') { this.storage=storage; this.id=id; this.dataset=dataset; this.rows=[]; this.lastSave=0; this.failed=false; }
  append(role,text,context={}) {
    this.rows.push({at:Date.now(),role,text:String(text).slice(0,1200),...context});
    this.rows=this.rows.slice(-600); this.save();
  }
  save() {
    try {
      let threads=JSON.parse(this.storage?.getItem(JOURNAL_KEY)||'[]');
      if(!Array.isArray(threads)) threads=[];
      threads=threads.filter(t=>t.id!==this.id).slice(-4);
      threads.push({id:this.id,dataset:this.dataset,updatedAt:Date.now(),rows:this.rows});
      this.storage?.setItem(JOURNAL_KEY,JSON.stringify(threads)); this.failed=!this.storage; this.lastSave=Date.now();
    } catch { this.failed=true; }
  }
}
