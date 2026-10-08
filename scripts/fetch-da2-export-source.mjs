import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=new URL('../tests/.metric-cache/da2-source/',import.meta.url);
await mkdir(source,{recursive:true});
const revision='fd2c22027eaf20374204f14099b8341e1925ad39';
for(const file of ['config.json','preprocessor_config.json','model.safetensors']){
  const target=new URL(file,source);
  const cached=await readFile(target).catch(()=>null);
  if(cached){if(file==='model.safetensors'&&createHash('sha256').update(cached).digest('hex')!=='ad065c77a7421ca55159a1f0db9433397a607690f2d76bb8a6fc54b1be7a3124')throw Error('Wrong pinned weights');continue;}
  const response=await fetch(`https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf/resolve/${revision}/${file}`);
  if(!response.ok)throw Error(`${file}: HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(file==='model.safetensors'&&createHash('sha256').update(bytes).digest('hex')!=='ad065c77a7421ca55159a1f0db9433397a607690f2d76bb8a6fc54b1be7a3124')throw Error('Wrong pinned weights');
  await writeFile(target,bytes);console.log(`Verified source ${file}: ${bytes.length} bytes`);
}
