/** RT-DETR focal-loss decoding. Matches HF Python sigmoid + flattened top num_queries.
 * Transformers.js 3.8.1's generic DETR decoder instead uses softmax/background.
 * Kept instance-local to DriveSense; no library or other engine monkey-patch.
 */
export const DRIVE_DECODER='rtdetr-focal-sigmoid-topk-v1';
interface TensorView {dims:readonly number[];data:ArrayLike<number>}
interface Outputs {logits:TensorView;pred_boxes:TensorView}
interface Decoded {boxes:number[][];classes:number[];scores:number[]}

export function decodeFocal(outputs:Outputs,threshold=.5,targetSizes:readonly (readonly number[])[]|null=null):Decoded[] {
  const {logits,pred_boxes:boxes}=outputs;
  if(!logits||!boxes||logits.dims.length!==3||boxes.dims.length!==3)throw Error('RT-DETR: tensor rank không hợp lệ.');
  const [batch,queries,classes]=logits.dims;
  if(![batch,queries,classes].every(n=>Number.isInteger(n)&&n>0)||batch>8||queries>1000||classes>1000||
    boxes.dims[0]!==batch||boxes.dims[1]!==queries||boxes.dims[2]!==4||
    logits.data.length!==batch*queries*classes||boxes.data.length!==batch*queries*4||
    !Number.isFinite(threshold)||threshold<0||threshold>1)throw Error('RT-DETR: shape/threshold không hợp lệ.');
  if(targetSizes&&(targetSizes.length!==batch||targetSizes.some(s=>s.length!==2||s.some(n=>!Number.isFinite(n)||n<=0))))throw Error('RT-DETR: kích thước ảnh không hợp lệ.');
  const result:Decoded[]=[];
  for(let b=0;b<batch;b++){
    const candidates:Array<{index:number;score:number}>=[];
    for(let i=0;i<queries*classes;i++){
      const logit=logits.data[b*queries*classes+i];
      if(!Number.isFinite(logit))throw Error('RT-DETR: logits không hữu hạn.');
      const score=1/(1+Math.exp(-logit));
      if(score>threshold)candidates.push({index:i,score});
    }
    candidates.sort((a,c)=>c.score-a.score||a.index-c.index);
    const decoded:Decoded={boxes:[],classes:[],scores:[]};
    const [height,width]=targetSizes?.[b]??[1,1];
    for(const {index,score} of candidates.slice(0,queries)){
      const query=Math.floor(index/classes),offset=(b*queries+query)*4;
      const cx=boxes.data[offset],cy=boxes.data[offset+1],w=boxes.data[offset+2],h=boxes.data[offset+3];
      if(![cx,cy,w,h].every(Number.isFinite)||w<=0||h<=0)throw Error('RT-DETR: box không hợp lệ.');
      decoded.boxes.push([(cx-w/2)*width,(cy-h/2)*height,(cx+w/2)*width,(cy+h/2)*height]);
      decoded.classes.push(index%classes);decoded.scores.push(score);
    }
    result.push(decoded);
  }
  return result;
}

/** Fail loudly if the pinned pipeline contract changes instead of silently misdecoding. */
export function installDriveDecoder(pipeline:unknown):void {
  const p=pipeline as {model?:{config?:{model_type?:string;use_focal_loss?:boolean}};processor?:{image_processor?:{post_process_object_detection?:unknown}}};
  if(p?.model?.config?.model_type!=='rt_detr_v2'||p.model.config.use_focal_loss!==true||
    typeof p.processor?.image_processor?.post_process_object_detection!=='function')throw Error('DriveSense: model không đúng hợp đồng RT-DETRv2 focal-loss.');
  p.processor.image_processor.post_process_object_detection=decodeFocal;
}
