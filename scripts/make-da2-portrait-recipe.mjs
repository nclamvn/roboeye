/** Packaging only: independently export/parity-check the portrait model FIRST.
 * Store a compact binary delta against immutable landscape weights, avoiding a
 * second 99 MB Git blob or an invented release asset. Never patch graph shapes
 * by guesswork. The reconstructed file must match the native export hash. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
const root=new URL('..',import.meta.url),base=await readFile(new URL('public/models/drive-metric/da2-outdoor-392x224.onnx',root));
const portrait=await readFile(new URL('tests/.metric-cache/da2-drive-224x392.onnx',root));
const manifest=JSON.parse(await readFile(new URL('tests/.metric-cache/da2-drive-224x392-manifest.json',root),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
if(sha(base)!=='dc868d88c5b97570f59863641092f7a517b85ef567de883a988d7df0e8b7250f'||sha(portrait)!==manifest.sha256||!(manifest.nativeExportMaxAbsM<.01))throw Error('Unverified input to recipe');
const block=2048,index=new Map(),key=b=>createHash('md5').update(b).digest('hex');
for(let at=0;at+block<=base.length;at+=block){const hash=key(base.subarray(at,at+block));if(!index.has(hash))index.set(hash,at);}
const operations=[],literals=[];let cursor=0,literalStart=0;
while(cursor+block<=portrait.length){
  const offset=index.get(key(portrait.subarray(cursor,cursor+block)));
  if(offset===undefined||!base.subarray(offset,offset+block).equals(portrait.subarray(cursor,cursor+block))){cursor++;continue;}
  if(cursor>literalStart){const part=portrait.subarray(literalStart,cursor);operations.push({insert:literals.length,length:part.length});literals.push(part);}
  let length=block;
  while(cursor+length+block<=portrait.length&&offset+length+block<=base.length&&base.subarray(offset+length,offset+length+block).equals(portrait.subarray(cursor+length,cursor+length+block)))length+=block;
  operations.push({copy:offset,length});cursor+=length;literalStart=cursor;
}
if(literalStart<portrait.length){const part=portrait.subarray(literalStart);operations.push({insert:literals.length,length:part.length});literals.push(part);}
const recipe={schema:'verified-native-export-binary-delta-v1',baseSha256:sha(base),baseBytes:base.length,targetSha256:sha(portrait),targetBytes:portrait.length,
  nativeParity:manifest,operations,literals:literals.map(b=>deflateRawSync(b).toString('base64'))};
const encoded=JSON.stringify(recipe)+'\n';if(encoded.length>2*1024*1024)throw Error(`Recipe too large: ${encoded.length}; choose another packaging route, do not weaken pins.`);
await writeFile(new URL('scripts/da2-portrait.recipe.json',root),encoded);console.log(`Verified native portrait recipe: ${encoded.length} bytes / ${operations.length} operations`);
