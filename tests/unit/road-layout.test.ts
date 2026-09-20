import {test} from 'node:test';
import assert from 'node:assert/strict';
import {laneIconPosition} from '../../src/drive/road-layout';
test('lane icon anchors inside vertically letterboxed video, not viewport header',()=>{
  assert.deepEqual(laneIconPosition(0,400,1500,844,60),{left:12,top:412,size:42});
});
test('lane icon follows pillarboxing and avoids overlapping chrome',()=>{
  assert.deepEqual(laneIconPosition(500,0,500,900,54),{left:512,top:62,size:42});
});
test('lane icon clamps inside very small images instead of escaping below them',()=>{
  for(const [x,y,w,h] of [[0,0,390,219],[40,20,50,30],[0,0,5,5],[0,0,1920,1080]]){
    const p=laneIconPosition(x,y,w,h,120);
    assert.ok(p.left>=x&&p.top>=y&&p.left+p.size<=x+w&&p.top+p.size<=y+h);
  }
});
