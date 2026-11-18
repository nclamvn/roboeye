/** Narrow read-only publication gate for the already verified M8 derivatives. */
import { resolve, posix } from 'node:path';
import { proposeEvidenceReviews } from '../tools/court/contact.mjs';

export const FROZEN_EVENT_MANIFEST_SHA = 'f973c0692dc9b44fda54a9351366003170735c75eb1cf0f2f5a94600a35d752b';
export const FROZEN_MEDIA_QA_SHA = 'd1c72dd24c69d55b31efc058d491e518fe58cb56e6db4c68e947c70e38db0203';
const same = (a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function eventAssetRows(manifest) {
  const rows=new Map();
  for(const e of manifest.events){for(const asset of[e.still,...e.context.filter(c=>c.status==='available').map(c=>c.asset),e.clip]){
    if(!asset||!/^stills\/frame-\d{6}\.png$|^clips\/frames-\d{6}-\d{6}\.mp4$/.test(asset.path)||posix.normalize(asset.path)!==asset.path||!/^[a-f0-9]{64}$/.test(asset.sha256)||!Number.isInteger(asset.bytes)||asset.bytes<=0||asset.bytes>32*1024**2)throw Error('Invalid pinned derivative asset');
    if(rows.has(asset.path)&&!same(rows.get(asset.path),asset))throw Error('Conflicting derivative asset metadata');rows.set(asset.path,asset);
  }}
  if(rows.size!==12)throw Error('Frozen M8 derivative set changed');
  return [...rows.values()];
}
export async function preparePinnedEventEvidence({root,eventEvidenceRoot,original,sessions,readAllowlistedFile,sha256,rejectPrivateContent,authorization}) {
  const directory=resolve(root,eventEvidenceRoot??'.court-cache/m8/evidence');
  const bytes=await readAllowlistedFile(directory,'manifest.json',FROZEN_EVENT_MANIFEST_SHA),manifest=JSON.parse(bytes);
  if(manifest.schemaVersion!=='roboeye-court-event-evidence-v1'||manifest.source.sha256!==original.sha256||manifest.sessionHashBinding!=='inputCachedSessionSha256'||manifest.source.width!==854||manifest.source.height!==480||manifest.source.fps!==25||manifest.source.frameCount!==337)throw Error('Unapproved derivative source');
  for(const arm of['classical','specialist'])if(manifest.sessionSha256[arm]!==original[arm].sha256)throw Error('Derivative input session pin mismatch');
  const actual=proposeEvidenceReviews(sessions);
  if(manifest.policyVersion!==actual.policyVersion||manifest.events.length!==actual.proposals.length)throw Error('Event policy differs from frozen derivative manifest');
  for(const e of manifest.events){const p=actual.proposals.find(p=>p.id===e.id);if(!p||e.index!==p.index||e.kind!==p.kind||!same(e.reviewInterval,p.reviewInterval)||!same(e.clipWindow,p.clipWindow)||!same(e.anchorPoint,p.point)||e.contact!==null||e.decision!=='insufficient-evidence')throw Error('Derivative event/window differs from current source observations');
    if(e.still.sourceFrame!==e.index||e.context.length!==5||!same(e.context.map(c=>c.offset),[-2,-1,0,1,2]))throw Error('Derivative still context mismatch');
    const c=e.clip;if(c.sourceStartFrame!==e.clipWindow.startFrame||c.sourceEndFrame!==e.clipWindow.endFrame||c.frameCount!==c.sourceEndFrame-c.sourceStartFrame+1||c.frameCount>75||c.fps!==25||c.width!==854||c.height!==480||Math.abs(c.durationSeconds-c.frameCount/25)>1e-9||c.contentType!=='video/mp4')throw Error('Derivative clip timeline mismatch');
  }
  const qaBytes=await readAllowlistedFile(resolve(root,'docs/evidence/court-m8'),'media-source-verification.json',FROZEN_MEDIA_QA_SHA),qa=JSON.parse(qaBytes);
  if(!qa.pass||qa.sourceSha256!==original.sha256||qa.manifestSha256!==FROZEN_EVENT_MANIFEST_SHA||qa.events.length!==2||qa.events.some(e=>e.bestContentAlignmentOffsetFrames!==0||e.stillPixelChecks.some(p=>p.differentChannels!==0)||!e.actualClipAudioPresent))throw Error('Missing verified source pixel/sequence receipt');
  const files=new Map([['demo/events/manifest.json',bytes]]),allowedFiles=[];
  for(const asset of eventAssetRows(manifest)){
    const data=await readAllowlistedFile(directory,asset.path,asset.sha256);
    if(data.length!==asset.bytes)throw Error('Derivative byte count mismatch');
    if(asset.path.endsWith('.png')){if(asset.contentType!=='image/png'||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||data.readUInt32BE(16)!==854||data.readUInt32BE(20)!==480||asset.width!==854||asset.height!==480)throw Error('Unapproved derivative PNG');}
    else if(data.subarray(4,8).toString()!=='ftyp')throw Error('Unapproved derivative MP4');
    rejectPrivateContent(asset.path,'derivative filename',authorization);rejectPrivateContent(data.toString('utf8'),'pinned derivative binary metadata',authorization);
    const path=`demo/events/${asset.path}`;files.set(path,data);allowedFiles.push({path,bytes:data.length,sha256:sha256(data)});
  }
  rejectPrivateContent(manifest,'derivative manifest',authorization);
  return {files,manifest,pin:{path:'./events/manifest.json',sha256:FROZEN_EVENT_MANIFEST_SHA},allowedFiles,qaSha256:FROZEN_MEDIA_QA_SHA};
}
