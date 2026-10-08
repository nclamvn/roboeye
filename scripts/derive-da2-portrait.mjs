import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
const root=new URL('..',import.meta.url),recipe=JSON.parse(await readFile(new URL('scripts/da2-portrait.recipe.json',root),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
if(recipe.schema!=='verified-native-export-binary-delta-v1')throw Error('Unsupported model recipe');
if(recipe.baseSha256!=='dc868d88c5b97570f59863641092f7a517b85ef567de883a988d7df0e8b7250f'||recipe.targetSha256!=='102c3b87a5610f57b7c337e0e7364d774b4648d5d6e2fb2cba6ed11fe60b6710'||recipe.targetBytes!==99159816)throw Error('Model recipe does not match pinned contracts');
const target=new URL('public/models/drive-metric/da2-outdoor-224x392.onnx',root),old=await readFile(target).catch(()=>null);
if(old&&old.length===recipe.targetBytes&&sha(old)===recipe.targetSha256){console.log('[drive-models] verified portrait');}
else{
  const base=await readFile(new URL('public/models/drive-metric/da2-outdoor-392x224.onnx',root));
  if(base.length!==recipe.baseBytes||sha(base)!==recipe.baseSha256)throw Error('Portrait base does not match pinned model');
  const parts=recipe.operations.map(op=>{
    if(!Number.isInteger(op.length)||op.length<1)throw Error('Invalid delta length');
    if(op.copy!==undefined){if(!Number.isInteger(op.copy)||op.copy<0||op.copy+op.length>base.length)throw Error('Invalid delta copy');return base.subarray(op.copy,op.copy+op.length);}
    const bytes=inflateRawSync(Buffer.from(recipe.literals[op.insert],'base64'),{maxOutputLength:recipe.targetBytes});
    if(bytes.length!==op.length)throw Error('Invalid delta insert');return bytes;
  });
  const output=Buffer.concat(parts);
  if(output.length!==recipe.targetBytes||sha(output)!==recipe.targetSha256)throw Error('Reconstructed model differs from verified native export');
  await mkdir(new URL('public/models/drive-metric/',root),{recursive:true});await writeFile(target,output);
  console.log(`[drive-models] reconstructed verified native portrait ${output.length} bytes`);
}
