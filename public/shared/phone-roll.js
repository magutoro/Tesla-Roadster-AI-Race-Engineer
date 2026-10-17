// Intentional tilt gestures become a single existing ROLL input, never a held repeat.
export class PhoneRollGesture {
  constructor(settings) { this.settings=settings; this.reset(); }
  reset() { this.eligible=false; this.armed=false; this.direction=0; this.until=0; this.nextRollAt=0; }
  update(angle, eligible, rolling, now) {
    if(!eligible || !Number.isFinite(angle)) { this.eligible=false; this.armed=false; this.direction=0; return 0; }
    const centered=Math.abs(angle)<=this.settings.rollRearmDeg;
    // A turn already held during takeoff must not unexpectedly become a flip.
    if(!this.eligible) { this.armed=centered; this.eligible=true; }
    if(centered && now>=this.until && now>=this.nextRollAt && !rolling) this.armed=true;
    if(this.armed && !rolling && now>=this.nextRollAt && Math.abs(angle)>=this.settings.rollTiltDeg) {
      this.direction=Math.sign(angle); this.armed=false;
      this.until=now+this.settings.rollPulseMs;
      this.nextRollAt=now+this.settings.rollCooldownMs;
    }
    return now<this.until ? this.direction : 0;
  }
}
