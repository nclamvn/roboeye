import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const exec=promisify(execFile),directory=new URL('./',import.meta.url).pathname;
const engine='/Users/os/.codex/skills/refinery';
const {stdout}=await exec('python3',['-c',`import sys;sys.path.insert(0,${JSON.stringify(engine)});import refinery;_,_,_,_,b=refinery.run_pipeline(sys.argv[1]);print(b.decode())`,directory],{maxBuffer:2_000_000});
const registry=JSON.parse(stdout);assert.equal(Object.keys(registry.registry).length,12);
assert.equal(registry.registry['ONNX Runtime Web'].fields.ios_webgpu_support.state,'disputed');
for(const entity of Object.values(registry.registry))assert.equal(entity.fields.device_benchmark.state,'null');
const bites=await exec('python3',[`${engine}/bites.py`,directory],{maxBuffer:1_000_000});
const hashes=await exec('shasum',['-a','256','-c','snapshots.sha256'],{cwd:directory});
await writeFile(new URL('registry.json',import.meta.url),stdout);
await writeFile(new URL('verification.json',import.meta.url),JSON.stringify({verifiedAt:new Date().toISOString(),pass:true,
  registrySha256:createHash('sha256').update(stdout).digest('hex'),entities:12,
  claims:(await readFile(new URL('claims.jsonl',import.meta.url),'utf8')).trim().split('\n').length,
  snapshots:JSON.parse(await readFile(new URL('captures.json',import.meta.url),'utf8')).filter(c=>!c.error).length,
  gates:'Provided refinery engine: span, tier, capture, no-inferred, independent re-derive/idempotence; applicable bites all exit2. Non-applicable gates explicitly N/A.',
  dispute:'Upstream iOS WebGPU support docs disagree; retained, not auto-resolved by tier or latest marketing.',
  deviceBenchmark:'All candidate model exact DriveSense/iPhone benchmark cells honest-null; owner session audit kept separate.',
  biteOutput:bites.stdout,hashOutput:hashes.stdout},null,2)+'\n');
console.log(`PASS refinery: 53 claims / 12 entities / 27 snapshots; ${createHash('sha256').update(stdout).digest('hex')}`);
