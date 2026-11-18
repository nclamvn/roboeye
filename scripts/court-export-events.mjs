/** Local-only source evidence export. No labels, uploads, model calls or installs. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, statfs, readFile, writeFile, mkdir, mkdtemp, rm, realpath, rename, readdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { validateSession } from './court-server-core.mjs';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCOPE = resolve(ROOT, '.court-cache/m8');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function hashFile(path) { const hash = createHash('sha256'); for await (const part of createReadStream(path)) hash.update(part); return hash.digest('hex'); }
async function regular(path, max) { const info=await lstat(path); if(info.isSymbolicLink()||!info.isFile()||info.size>max)throw Error('Regular bounded input required'); return info; }
export async function scopedOutput(output) {
  const path=resolve(ROOT,output), rel=relative(SCOPE,path);
  if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith(`..${sep}`))throw Error('Output must be a dedicated ignored .court-cache/m8 child');
  await mkdir(SCOPE,{recursive:true}); let cursor=SCOPE;
  if((await lstat(cursor)).isSymbolicLink()||await realpath(cursor)!==cursor)throw Error('Symlink output scope denied');
  for(const part of rel.split(sep)){cursor=join(cursor,part);try{if((await lstat(cursor)).isSymbolicLink())throw Error('Symlink output denied');}catch(e){if(e.code!=='ENOENT')throw e;}}
  // Never write through child symlinks or overwrite an earlier/user-owned tree.
  // Reusing verified assets belongs to the read-only public packaging gate.
  try{if((await readdir(path)).length)throw Error('Fresh empty dedicated output required; existing entries are preserved');}catch(e){if(e.code!=='ENOENT')throw e;}
  return path;
}
async function runHelper(python, video, job, output) {
  return new Promise((resolveResult,reject)=>{
    const child=spawn(python,[join(ROOT,'scripts/court_export_event_media.py'),'--video',video,'--job',job,'--output',output],{cwd:ROOT,detached:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',done=false;
    const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}};
    const timer=setTimeout(()=>{kill();reject(Error('Bounded media export timeout'));},180000);
    child.stdout.on('data',b=>{stdout+=b;if(stdout.length>2*1024**2){kill();reject(Error('Media receipt exceeds limit'));}});
    child.stderr.on('data',b=>{stderr+=b;if(stderr.length>128*1024){kill();reject(Error('Media diagnostic exceeds limit'));}});
    child.on('error',()=>{clearTimeout(timer);reject(Error('Existing local Python runtime unavailable'));});
    child.on('close',code=>{clearTimeout(timer);if(done)return;done=true;if(code!==0)return reject(Error('Local media extraction failed; no valid manifest written'));try{resolveResult(JSON.parse(stdout));}catch{reject(Error('Malformed media extraction receipt'));}});
  });
}
export async function exportCourtEvents({video,classical,specialist,output,python=join(ROOT,'native/ios/.build-xcode/scene-qa/venv/bin/python')}) {
  const target=await scopedOutput(output), sourceVideo=resolve(ROOT,video);
  await regular(sourceVideo,500*1024**2); const sourceSha=await hashFile(sourceVideo);
  const sessions={},sessionSha256={};
  for(const [arm,path] of Object.entries({classical,specialist})){const input=resolve(ROOT,path);await regular(input,32*1024**2);const bytes=await readFile(input);sessions[arm]=validateSession(JSON.parse(bytes),sourceSha);sessionSha256[arm]=sha(bytes);}
  const source=sessions.classical.source;
  if(['width','height','fps','frameCount','durationSeconds'].some(k=>source[k]!==sessions.specialist.source[k]))throw Error('Session source timelines differ');
  const disk=await statfs(SCOPE);if(Number(disk.bavail)*Number(disk.bsize)<10*1024**3)throw Error('Less than10GiB free; export stopped');
  const {proposeEvidenceReviews}=await import('../tools/court/contact.mjs');
  const proposed=proposeEvidenceReviews(sessions);
  if(proposed.sourceSha256!==sourceSha||!Array.isArray(proposed.proposals)||proposed.proposals.length>10)throw Error('Invalid bounded source reviews');
  const events=proposed.proposals;
  for(const e of events){if(e.sourceSha256!==sourceSha||e.decision!=='insufficient-evidence'||e.contact!==null||!['suspected-contact','edge-loss-review'].includes(e.kind))throw Error('Review source/uncertainty mismatch');
    if(!Number.isInteger(e.index)||e.index<0||e.index>=source.frameCount||Math.abs(e.timeSeconds-e.index/source.fps)>1e-5)throw Error('Invalid actual review anchor');
    if(!e.arms.some(arm=>sessions[arm]?.frames[e.index]?.status==='observed'&&sessions[arm].frames[e.index].ball&&Math.hypot(sessions[arm].frames[e.index].ball.x-e.point[0],sessions[arm].frames[e.index].ball.y-e.point[1])<1e-5))throw Error('Anchor must be an actual observed source point');
    for(const w of[e.reviewInterval,e.clipWindow])if(!w||!Number.isInteger(w.startFrame)||!Number.isInteger(w.endFrame)||w.startFrame<0||w.startFrame>e.index||w.endFrame<e.index||w.endFrame>=source.frameCount)throw Error('Invalid inclusive review/clip range');
  }
  await mkdir(target,{recursive:true});const scratch=await mkdtemp(join(SCOPE,'.event-export-job-'));
  try{
    const job=join(scratch,'job.json');await writeFile(job,JSON.stringify({source:{sha256:sourceSha,width:source.width,height:source.height,fps:source.fps,frameCount:source.frameCount,durationSeconds:source.durationSeconds},events}));
    const media=await runHelper(python,sourceVideo,job,target);
    const result={schemaVersion:'roboeye-court-event-evidence-v1',source:{sha256:sourceSha,width:source.width,height:source.height,fps:source.fps,frameCount:source.frameCount,durationSeconds:source.durationSeconds},sessionHashBinding:'inputCachedSessionSha256',sessionSha256,policyVersion:proposed.policyVersion,
      generator:{scriptSha256:sha(await readFile(new URL(import.meta.url))),mediaHelperSha256:sha(await readFile(join(ROOT,'scripts/court_export_event_media.py'))),proposalModuleSha256:sha(await readFile(join(ROOT,'tools/court/contact.mjs')))},
      events:events.map(e=>({id:e.id,index:e.index,kind:e.kind,timeSeconds:e.timeSeconds,reviewInterval:e.reviewInterval,clipWindow:e.clipWindow,anchorPoint:e.point,contact:null,decision:'insufficient-evidence',still:media.stills[String(e.index)],context:[-2,-1,0,1,2].map(offset=>{const i=e.index+offset;return i<0||i>=source.frameCount?{offset,sourceFrame:null,status:'out-of-range'}:{offset,sourceFrame:i,status:'available',asset:media.stills[String(i)]};}),clip:media.clips[e.id]})),
      extraction:{sourceAudioPresent:media.sourceAudioPresent,sourceDecodedFrames:media.sourceDecodedFrames,sourceMaximumPtsResidualSeconds:media.sourceMaximumPtsResidualSeconds,decoder:media.decoder,ffmpegVersion:media.ffmpegVersion},
      limitation:'Actual source stills/clips for uncertain event review. Anchor timestamp is an observed image, not a certified floor-contact time or position. No labels, AI-filled pixels, invented frames, In/Out or metric-distance inference.'};
    for(const e of result.events){if(!e.still||!e.clip||e.context.some(c=>c.status==='available'&&!c.asset))throw Error('Incomplete media asset receipt');}
    const serialized=JSON.stringify(result,null,2)+'\n';if(/\/Users\/|\/private\/|file:\/\/|1794900295688/.test(serialized))throw Error('Private path in media manifest');
    const temp=join(target,'manifest.pending.json');await writeFile(temp,serialized);await rename(temp,join(target,'manifest.json'));
    return {manifest:result,manifestSha256:sha(Buffer.from(serialized)),output:relative(ROOT,target)};
  }finally{await rm(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const args=process.argv.slice(2),values={};for(let i=0;i<args.length;i+=2){if(!['--video','--classical','--specialist','--output','--python'].includes(args[i])||!args[i+1]||values[args[i].slice(2)])throw Error('Invalid explicit CLI arguments');values[args[i].slice(2)]=args[i+1];}for(const key of['video','classical','specialist','output'])if(!values[key])throw Error('Missing explicit input/output');
    const r=await exportCourtEvents(values);console.log(JSON.stringify({output:r.output,manifestSha256:r.manifestSha256,events:r.manifest.events.map(e=>({id:e.id,index:e.index,kind:e.kind,clipWindow:e.clipWindow,frames:e.clip.frameCount}))},null,2));
  }catch(error){console.error(`Court local evidence export refused: ${error.message}`);process.exitCode=1;}
}
