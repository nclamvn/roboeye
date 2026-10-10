import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
const destination=new URL('../public/models/drive-detector/yolox-nano-416.onnx',import.meta.url);
const url='https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx';
const bytes=3659407,sha256='c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d';
const valid=b=>b.length===bytes&&createHash('sha256').update(b).digest('hex')===sha256;
if(await readFile(destination).then(valid).catch(()=>false)){console.log('[drive-lite] pinned official Nano verified');}
else{
  await mkdir(new URL('.',destination),{recursive:true});
  const temporary=new URL(`${destination.href}.part`);
  try{
    const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`HTTP ${r.status}`);
    const b=Buffer.from(await r.arrayBuffer());if(!valid(b))throw Error('Official Nano byte/SHA mismatch');
    await writeFile(temporary,b);await rename(temporary,destination);console.log('[drive-lite] official Nano downloaded and SHA verified');
  }finally{await rm(temporary,{force:true});}
}
const license=new URL('../public/licenses/yolox-nano-LICENSE.txt',import.meta.url);
const licenseHash='0ec3668d3274bcf29e8a29e9576d5a2cd96fc78d3c5bec4387355a796e5d9088';
if(!await readFile(license).then(b=>b.length===11371&&createHash('sha256').update(b).digest('hex')===licenseHash).catch(()=>false)){
  const response=await fetch('https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/6ddff4824372906469a7fae2dc3206c7aa4bbaee/LICENSE',{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`License HTTP ${response.status}`);const b=Buffer.from(await response.arrayBuffer());
  if(b.length!==11371||createHash('sha256').update(b).digest('hex')!==licenseHash)throw Error('Pinned Apache license mismatch');
  await mkdir(new URL('.',license),{recursive:true});await writeFile(license,b);
}
// Retain the isolated runtime's own licence and upstream third-party notices.
for(const [name,length,digest] of [
  ['LICENSE',1073,'2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c'],
  ['ThirdPartyNotices.txt',338088,'143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3']]){
  const target=new URL(`../public/licenses/onnxruntime-web-1.30-${name}.txt`,import.meta.url);
  const verifies=b=>b.length===length&&createHash('sha256').update(b).digest('hex')===digest;
  if(await readFile(target).then(verifies).catch(()=>false))continue;
  const response=await fetch(`https://raw.githubusercontent.com/microsoft/onnxruntime/v1.30.0/${name}`,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`ORT ${name}: HTTP ${response.status}`);const b=Buffer.from(await response.arrayBuffer());
  if(!verifies(b))throw Error(`ORT ${name}: SHA mismatch`);await writeFile(target,b);
}
