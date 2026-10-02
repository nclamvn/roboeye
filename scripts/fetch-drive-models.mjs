import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, rename, rm, stat} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const artifacts=[
  {
    directory:'drive-metric',file:'da2-outdoor-392x224.onnx',bytes:99159817,
    sha256:'dc868d88c5b97570f59863641092f7a517b85ef567de883a988d7df0e8b7250f',
    url:'https://github.com/nclamvn/roboeye/releases/download/drivesense-models-v1/da2-outdoor-392x224.onnx',
  },
  {
    directory:'drive-detector',file:'rtdetr-r18-640-webgpu.onnx',bytes:81033458,
    sha256:'86171edeb435bd3f113e82d1c6720a576932e6deca962426bb1bc794e7000458',
    url:'https://github.com/nclamvn/roboeye/releases/download/drivesense-models-v1/rtdetr-r18-640-webgpu.onnx',
  },
];

async function digest(path){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex');
}

async function valid(path,artifact){
  try{
    const info=await stat(path);
    return info.isFile()&&info.size===artifact.bytes&&(await digest(path))===artifact.sha256;
  }catch{return false;}
}

for(const artifact of artifacts){
  const directory=`${root}public/models/${artifact.directory}`;
  const destination=`${directory}/${artifact.file}`;
  if(await valid(destination,artifact)){
    console.log(`[drive-models] verified ${artifact.file}`);
    continue;
  }
  await mkdir(directory,{recursive:true});
  const temporary=`${destination}.${process.pid}.part`;
  await rm(temporary,{force:true});
  try{
    const response=await fetch(artifact.url,{redirect:'follow'});
    if(!response.ok||!response.body)throw Error(`HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary,{flags:'wx'}));
    if(!(await valid(temporary,artifact)))throw Error(`artifact không khớp ${artifact.bytes} byte / SHA-256 đã pin`);
    await rename(temporary,destination);
    console.log(`[drive-models] downloaded and verified ${artifact.file}`);
  }catch(error){
    await rm(temporary,{force:true});
    throw new Error(`[drive-models] không thể chuẩn bị ${artifact.file}: ${error instanceof Error?error.message:String(error)}`);
  }
}
