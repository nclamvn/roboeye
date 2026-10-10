import {fitAnchorProfile,parseAnchorProfile,type AnchorProfile,type RangeAnchor} from './anchor-range';
type Identity={width:number;height:number;zoom:number;ticket:number;available:boolean};
/** A local frozen image is used only for point picking; never exported or stored. */
export class AnchorUI {
  private points:RangeAnchor[]=[];private selected:{u:number;v:number}|null=null;
  private frozen:Identity|null=null;private applied:AnchorProfile|null=null;
  private image:ImageData|null=null;
  private canvas=document.getElementById('anchor-view') as HTMLCanvasElement;
  private context=this.canvas.getContext('2d',{willReadFrequently:true})!;
  private status=document.getElementById('anchor-status')!;
  constructor(private video:HTMLVideoElement,private identity:()=>Identity,private apply:(p:AnchorProfile|null)=>void){
    const button=(id:string,action:()=>void)=>{document.getElementById(id)!.onclick=()=>{try{action();}catch(e){this.status.textContent=e instanceof Error?e.message:String(e);}};};
    button('anchor-freeze',()=>this.freeze());button('anchor-add',()=>this.add());
    button('anchor-fit',()=>{this.assertCurrent();if(!(document.getElementById('anchor-confirm') as HTMLInputElement).checked)throw Error('Xác nhận mốc đã đo, camera cố định và đường phẳng trước khi áp dụng.');
      const p=fitAnchorProfile(this.frozen!.width,this.frozen!.height,this.frozen!.zoom,this.points);this.apply(p);this.applied=p;
      this.status.textContent=`Theo mốc: ${p.minM.toFixed(1)}–${p.maxM.toFixed(1)} m · sai số kiểm ${p.checkMAEM.toFixed(2)} m. Giữ nguyên camera; chưa nghiệm thu thực địa.`;});
    button('anchor-reset',()=>{this.invalidate();this.apply(null);});
    button('anchor-export',()=>{if(!this.applied)throw Error('Chưa có mốc đã áp dụng.');const url=URL.createObjectURL(new Blob([JSON.stringify(this.applied,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='drivesense-ground-anchors.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    const input=document.getElementById('anchor-import') as HTMLInputElement;
    input.onchange=async()=>{try{const file=input.files?.[0];if(!file)return;if(file.size>30000)throw Error('Profile mốc vượt 30 KB.');
      if(!(document.getElementById('anchor-confirm') as HTMLInputElement).checked)throw Error('Chỉ nhập khi giữ đúng camera/lens/crop và điều kiện đã hiệu chuẩn.');
      const p=parseAnchorProfile(JSON.parse(await file.text())),id=this.identity();if(!id.available||p.width!==id.width||p.height!==id.height||p.zoom!==id.zoom)throw Error('Mở đúng nguồn/kích thước/zoom trước khi nhập.');
      this.points=structuredClone(p.points);this.applied=p;this.apply(p);this.list();this.status.textContent=`Mốc đã re-fit/kiểm: ${p.minM.toFixed(1)}–${p.maxM.toFixed(1)} m. Chỉ hợp lệ nếu mount/lens/crop không thay đổi.`;
    }catch(e){this.status.textContent=e instanceof Error?e.message:String(e);}finally{input.value='';}};
    this.canvas.addEventListener('pointerdown',event=>{if(!this.frozen)return;try{this.assertCurrent();const r=this.canvas.getBoundingClientRect();this.selected={u:(event.clientX-r.left)/r.width*this.canvas.width,v:(event.clientY-r.top)/r.height*this.canvas.height};this.paint();this.status.textContent=`Đã chọn (${Math.round(this.selected.u)}, ${Math.round(this.selected.v)}) · nhập mét rồi Thêm mốc.`;}catch(e){this.status.textContent=String(e);}});
    this.canvas.addEventListener('keydown',event=>{if(!this.frozen||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter'].includes(event.key))return;event.preventDefault();try{this.assertCurrent();this.selected??={u:this.canvas.width/2,v:this.canvas.height*.75};const step=event.shiftKey?10:1;this.selected.u=Math.min(this.canvas.width,Math.max(0,this.selected.u+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0)));this.selected.v=Math.min(this.canvas.height,Math.max(0,this.selected.v+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)));this.paint();if(event.key==='Enter')(document.getElementById('anchor-metres') as HTMLInputElement).focus();}catch(e){this.status.textContent=String(e);}});
  }
  invalidate(){this.points=[];this.selected=null;this.frozen=null;this.applied=null;this.image=null;this.canvas.hidden=true;(document.getElementById('anchor-confirm') as HTMLInputElement).checked=false;this.list();this.status.textContent='Chụp khung, chạm điểm tiếp xúc mặt đường và nhập mét đã đo. Cần 6 fit + 2 kiểm độc lập.';}
  private assertCurrent(){const id=this.identity();if(!this.frozen||!id.available||id.ticket!==this.frozen.ticket||id.width!==this.frozen.width||id.height!==this.frozen.height||id.zoom!==this.frozen.zoom)throw Error('Nguồn/zoom đã đổi; chụp khung và hiệu chuẩn lại.');}
  private freeze(){const id=this.identity();if(!id.available||!id.width||!id.height)throw Error('Mở camera/video và chờ khung hình; không hiệu chuẩn trên mẫu dựng hoặc lúc phân tích.');
    if(this.frozen&&(id.ticket!==this.frozen.ticket||id.width!==this.frozen.width||id.height!==this.frozen.height||id.zoom!==this.frozen.zoom))this.invalidate();
    this.frozen=id;this.canvas.width=id.width;this.canvas.height=id.height;this.context.drawImage(this.video,0,0,id.width,id.height);this.image=this.context.getImageData(0,0,id.width,id.height);this.canvas.hidden=false;this.selected=null;this.paint();this.status.textContent='Chạm mặt đường/chân xe tại một vị trí biết khoảng cách dọc phía trước camera.';}
  private add(){this.assertCurrent();if(!this.selected)throw Error('Chạm vị trí trên ảnh trước.');const zM=Number((document.getElementById('anchor-metres') as HTMLInputElement).value),split=(document.getElementById('anchor-split') as HTMLSelectElement).value;
    if(!Number.isFinite(zM)||zM<2||zM>80||!['fit','check'].includes(split))throw Error('Nhập khoảng cách đã đo 2–80 m và loại mốc.');
    if(this.points.length>=64)throw Error('Đã đủ 64 mốc.');this.applied=null;this.apply(null);this.points.push({...this.selected,zM,split:split as 'fit'|'check'});this.selected=null;this.list();this.paint();this.status.textContent='Đã thêm mốc. Các mốc phải trải ít nhất 8 m; mốc kiểm không dùng lại điểm fit.';}
  private list(){const list=document.getElementById('anchor-list')!;list.replaceChildren(...this.points.map((p,i)=>{const row=document.createElement('div');row.className='anchor-row';const text=document.createElement('span');text.textContent=`${p.split==='fit'?'Fit':'Kiểm'} · ${p.zM.toFixed(2)} m · (${Math.round(p.u)}, ${Math.round(p.v)})`;const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Xóa mốc ${i+1}`);remove.onclick=()=>{this.points.splice(i,1);this.applied=null;this.apply(null);this.list();this.paint();};row.append(text,remove);return row;}));
    (document.getElementById('anchor-split') as HTMLSelectElement).value=this.points.filter(p=>p.split==='fit').length<6?'fit':'check';}
  private paint(){if(!this.image)return;this.context.putImageData(this.image,0,0);this.context.font=`600 ${Math.max(16,this.canvas.width*.022)}px Inter,Arial`;
    for(const p of this.points){this.context.fillStyle=p.split==='fit'?'#78d5ef':'#f3c46d';this.context.beginPath();this.context.arc(p.u,p.v,Math.max(5,this.canvas.width*.008),0,Math.PI*2);this.context.fill();this.context.strokeStyle='#10212b';this.context.lineWidth=3;this.context.strokeText(`${p.zM.toFixed(1)} m`,p.u+10,p.v-10);this.context.fillText(`${p.zM.toFixed(1)} m`,p.u+10,p.v-10);}
    if(this.selected){this.context.strokeStyle='#fff';this.context.lineWidth=3;this.context.beginPath();this.context.arc(this.selected.u,this.selected.v,12,0,Math.PI*2);this.context.stroke();}}
}
