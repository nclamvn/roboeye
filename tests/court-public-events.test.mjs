import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { preparePublicData, exportCourtPublic, inventoryDirectory, originalPublicationAuthorization, SOURCE_ROOT, sha256 } from '../scripts/export-court-public.mjs';
import { FROZEN_EVENT_MANIFEST_SHA, eventAssetRows } from '../scripts/court-public-events.mjs';
import { scopedOutput } from '../scripts/court-export-events.mjs';
import { auditOriginalPackage } from './helpers/court-original-audit.mjs';
const cache=resolve(SOURCE_ROOT,'.court-cache/m8');await mkdir(cache,{recursive:true});
const input=resolve(SOURCE_ROOT,'.court-cache/m8/evidence'), original=resolve(SOURCE_ROOT,'../roboeye-court-public/dist/demo/videos/pickleball-original.mp4');
const manifestBytes=await readFile(join(input,'manifest.json')),manifest=JSON.parse(manifestBytes);

test('event evidence requires both explicit boolean opt-ins',async()=>{
  await assert.rejects(preparePublicData({includeEventEvidence:true}),/requires original/);
  await assert.rejects(preparePublicData({includeUserOriginal:true,includeEventEvidence:'true'}),/explicit boolean/);
});
test('fixed source-derived assets are advertised top-level; legacy original export has none',async()=>{
  const legacy=await preparePublicData({includeUserOriginal:true}),data=await preparePublicData({includeUserOriginal:true,includeEventEvidence:true,originalVideo:original});
  assert.equal(legacy.manifest.eventEvidence,undefined);assert.deepEqual(data.manifest.eventEvidence,{path:'./events/manifest.json',sha256:FROZEN_EVENT_MANIFEST_SHA});
  assert.equal(sha256(data.files.get('demo/events/manifest.json')),FROZEN_EVENT_MANIFEST_SHA);assert.equal([...data.files.keys()].filter(p=>p.startsWith('demo/events/')).length,13);
  assert.deepEqual(manifest.events.map(e=>[e.index,e.kind,e.clipWindow.startFrame,e.clipWindow.endFrame]),[[101,'suspected-contact',74,128],[232,'edge-loss-review',203,264]]);
  for(const [path,bytes]of legacy.files)if(path!=='demo/manifest.json')assert.deepEqual(data.files.get(path),bytes);
});
test('derivative format gate rejects traversal, oversize and conflicting pins',()=>{
  for(const mutate of[m=>m.events[0].still.path='../frame.png',m=>m.events[0].still.bytes=50*1024**2,m=>m.events[0].still.sha256='bad']){const bad=structuredClone(manifest);mutate(bad);assert.throws(()=>eventAssetRows(bad));}
});
test('publication rejects modified manifest and a pinned-source symlink without reencoding',async()=>{
  const dir=await mkdtemp(join(cache,'publication-guard-'));
  try{
    await writeFile(join(dir,'manifest.json'),Buffer.concat([manifestBytes,Buffer.from(' ')]));
    await assert.rejects(preparePublicData({includeUserOriginal:true,includeEventEvidence:true,eventEvidenceRoot:dir}),/SHA mismatch/);
    await writeFile(join(dir,'manifest.json'),manifestBytes);await mkdir(join(dir,'stills'));
    await symlink(join(input,manifest.events[0].still.path),join(dir,manifest.events[0].still.path));
    await assert.rejects(preparePublicData({includeUserOriginal:true,includeEventEvidence:true,eventEvidenceRoot:dir}),/Symlink/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('local extraction refuses populated outputs and child symlinks, preserving user contents',async()=>{
  const base=await mkdtemp(join(cache,'output-guard-'));
  try{
    const target=join(base,'output'),kept=join(base,'kept');await mkdir(target);await mkdir(kept);await writeFile(join(kept,'sentinel.txt'),'keep');await symlink(kept,join(target,'stills'));
    await assert.rejects(scopedOutput(target),/Fresh empty/);assert.equal(await readFile(join(kept,'sentinel.txt'),'utf8'),'keep');
    await assert.rejects(scopedOutput(SOURCE_ROOT),/dedicated/);assert.equal(await scopedOutput(join(base,'fresh')),join(base,'fresh'));
  }finally{await rm(base,{recursive:true,force:true});}
});
test('actual customer inventory is deterministic and rejects screenshots or omitted derivative opt-in',async()=>{
  const dir=await mkdtemp(join(cache,'customer-stage-'));
  try{
    const receipt=await exportCourtPublic({output:dir,includeUserOriginal:true,includeEventEvidence:true});
    const second=await exportCourtPublic({output:dir,includeUserOriginal:true,includeEventEvidence:true});assert.deepEqual(second,receipt);
    assert.equal(receipt.fileCount,39);assert.ok(receipt.totalBytes<24*1024**2);
    const inventory=await inventoryDirectory(dir,{publicationAuthorization:originalPublicationAuthorization(),includeEventEvidence:true});assert.deepEqual(inventory,receipt.files);
    assert.equal(inventory.filter(f=>f.path.endsWith('.png')).length,10);assert.equal(inventory.filter(f=>f.path.endsWith('.mp4')).length,6);
    const independent=await auditOriginalPackage(SOURCE_ROOT,dir);assert.equal(independent.eventEvidence.events.length,2);assert.equal(independent.inventory.length,40);
    await assert.rejects(inventoryDirectory(dir,{publicationAuthorization:originalPublicationAuthorization()}),/screenshot|allowlist/);
    await writeFile(join(dir,'screenshot.png'),await readFile(join(input,manifest.events[0].still.path)));
    await assert.rejects(inventoryDirectory(dir,{publicationAuthorization:originalPublicationAuthorization(),includeEventEvidence:true}),/screenshot/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('export code has no machine-specific original Downloads input',async()=>{
  assert.doesNotMatch(await readFile(resolve(SOURCE_ROOT,'scripts/export-court-public.mjs'),'utf8'),/\/Users\/[^\n]*Downloads/);
});
