import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('./',import.meta.url),manifest=JSON.parse(await readFile(new URL('captures.json',root),'utf8'));
for(const [id,url,source] of [
 ['metric3dhub','https://raw.githubusercontent.com/YvanYin/Metric3D/main/hubconf.py','Metric3D-authors'],
 ['metric3dcard','https://huggingface.co/onnx-community/metric3d-vit-small/raw/main/README.md','ONNX-community'],
 ['flashpaper','https://arxiv.org/html/2504.07093v2','Eyeline-FlashDepth'],
 ['gvpaper','https://arxiv.org/html/2412.06080v2','Zagreb-GVDepth'],
 ['m3license','https://raw.githubusercontent.com/YvanYin/Metric3D/main/LICENSE','Metric3D-authors'],
 ['flashlicense','https://raw.githubusercontent.com/Eyeline-Labs/FlashDepth/main/LICENSE','Eyeline-FlashDepth'],
 ['rtdetrcard','https://huggingface.co/onnx-community/rtdetr_v2_r18vd-ONNX/raw/main/README.md','ONNX-community'],
 ['rtdetrfiles','https://huggingface.co/api/models/onnx-community/rtdetr_v2_r18vd-ONNX/tree/main/onnx?recursive=false&expand=false','ONNX-community'],
 ['monoground','https://openaccess.thecvf.com/content/CVPR2022/html/Qin_MonoGround_Detecting_Monocular_3D_Objects_From_the_Ground_CVPR_2022_paper.html','CVF-MonoGround']
]){
 if(manifest.some(m=>m.id===id&&!m.error))continue;
 try{const r=await fetch(url,{signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error(`HTTP ${r.status}`);
 const b=Buffer.from(await r.arrayBuffer()),snapshot=id+'.txt';await writeFile(new URL('snapshots/'+snapshot,root),b);
 manifest.push({id,url,source,snapshot,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex'),fetched_at:new Date().toISOString()});
 console.log(id,b.length);
 }catch(e){manifest.push({id,url,source,error:String(e)});console.log(id,String(e));}
}
await writeFile(new URL('captures.json',root),JSON.stringify(manifest,null,2)+'\n');
