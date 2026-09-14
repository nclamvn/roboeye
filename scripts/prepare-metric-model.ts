import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MOGE_SMALL as model} from '../src/drive/metric-contract';
const directory=new URL('../tests/.metric-cache/',import.meta.url),target=new URL('moge-small.onnx',directory);
await mkdir(directory,{recursive:true});
function verify(bytes:Uint8Array){return bytes.length===model.bytes&&createHash('sha256').update(bytes).digest('hex')===model.sha256;}
let existing:Uint8Array|null=null;try{existing=await readFile(target);}catch{}
if(existing&&verify(existing))console.log('Metric model verified (pinned SHA-256).');
else {
  if(process.argv.includes('--verify-only'))throw Error('Missing/corrupt metric model.');
  const url=`https://huggingface.co/${model.id}/resolve/${model.revision}/model.onnx`;
  const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error(`HTTP ${response.status}`);
  const bytes=new Uint8Array(await response.arrayBuffer());if(!verify(bytes))throw Error('Downloaded model failed hash/size verification.');
  const temporary=new URL('moge-small.onnx.download',directory);await writeFile(temporary,bytes);await rename(temporary,target);
  console.log('Metric model downloaded and verified. Not a distance-accuracy benchmark.');
}
