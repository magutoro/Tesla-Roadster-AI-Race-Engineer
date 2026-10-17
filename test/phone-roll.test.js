import test from 'node:test';
import assert from 'node:assert/strict';
import {PhoneRollGesture} from '../public/shared/phone-roll.js';
import {CONFIG} from '../public/config.js';
test('ground steering never triggers a flip; airborne gestures choose left and right',()=>{
  for(const direction of [-1,1]) {
    const gesture=new PhoneRollGesture(CONFIG.phone);
    assert.equal(gesture.update(60*direction,false,false,0),0);
    assert.equal(gesture.update(0,true,false,100),0);
    assert.equal(gesture.update(30*direction,true,false,110),0);
    assert.equal(gesture.update(50*direction,true,false,120),direction);
    assert.equal(gesture.update(50*direction,true,false,200),direction);
    assert.equal(gesture.update(50*direction,true,false,300),0);
    assert.equal(gesture.update(50*direction,true,false,2000),0,'holding tilt cannot repeat');
    gesture.update(0,true,false,2100);
    assert.equal(gesture.update(-50*direction,true,false,2200),-direction);
  }
});
test('takeoff while already steering, a running roll, stale state and recalibration do not trigger rolls',()=>{
  const gesture=new PhoneRollGesture(CONFIG.phone);
  assert.equal(gesture.update(60,true,false,0),0,'must center after becoming eligible');
  gesture.update(0,true,true,100);
  assert.equal(gesture.update(60,true,true,110),0);
  gesture.update(0,true,false,200);
  assert.equal(gesture.update(60,true,false,210),1);
  assert.equal(gesture.update(60,false,false,220),0,'ineligible state cancels pending pulse');
  gesture.reset();assert.equal(gesture.update(60,true,false,3000),0);
});
