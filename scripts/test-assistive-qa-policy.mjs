import assert from 'node:assert/strict';
import {restoreInitialShutdown,boundedDiagnostic} from './assistive-qa-policy.mjs';
let passed=0;
function scenario(states,status,expected,commands) {
  let calls=0;const queue=[...states];
  const result=restoreInitialShutdown({query:()=>queue.shift(),shutdown:()=>{calls++;return {status,stdout:'bounded actual diagnostic',stderr:status===149?'already shut down':''};}});
  assert.equal(result.restored,expected);assert.equal(calls,commands);passed++;return result;
}
scenario([{state:'Shutdown',exitCode:0}],null,true,0);
scenario([{state:'Booted',exitCode:0},{state:'Shutdown',exitCode:0}],0,true,1);
assert.equal(scenario([{state:'Booted',exitCode:0},{state:'Shutdown',exitCode:0}],149,true,1).shutdown.exitCode,149);
scenario([{state:'Booted',exitCode:0},{state:'Booted',exitCode:0}],0,false,1);
scenario([{state:'Booted',exitCode:0},{state:'Booted',exitCode:0}],149,false,1);
scenario([{state:null,exitCode:1}],null,false,0);
scenario([{state:'Booted',exitCode:0},{state:null,exitCode:1}],0,false,1);
assert.equal(restoreInitialShutdown({query:()=>{throw Error('discovery unavailable');},shutdown:()=>{throw Error('must not execute');}}).restored,false);passed++;
assert.ok(boundedDiagnostic('E7A1775A-0000-0000-0000-000000000000').includes('[simulator-id]'));assert.ok(boundedDiagnostic('x'.repeat(3000)).length<=2048);passed++;
console.log(JSON.stringify({pass:true,cases:passed,scope:'Pure mocked restoration-policy cases; no simulator launched or shut down.'}));
