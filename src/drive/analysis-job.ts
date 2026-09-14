import {sampleTimes} from './replay';

export type AnalysisPhase='idle'|'reading'|'loading'|'running'|'ready'|'cancelled'|'error';
export type AnalysisAction='cancel'|'retry'|'choose'|'play'|null;
export interface AnalysisNotice {
  phase:AnalysisPhase;visible:boolean;title:string;detail:string;
  completed:number;total:number;action:AnalysisAction;actionLabel:string;
}

/** Presentation lifecycle, separate from risk/measurement freshness. No timers,
 * invented download percentage, or completed result from a partial analysis. */
export class FileAnalysisJob {
  phase:AnalysisPhase='idle';
  private total=0;private completed=0;private startedAt=0;private openedAt=0;
  private message='';private failureAction:AnalysisAction='retry';
  reset(){this.phase='idle';this.total=0;this.completed=0;this.message='';}
  open(now:number){this.reset();this.phase='reading';this.openedAt=now;}
  metadataExpired(now:number){return this.phase==='reading'&&now-this.openedAt>15000;}
  prepare(durationMs:number){
    // This throws BEFORE a caller is allowed to initialise inference workers.
    const times=sampleTimes(durationMs);
    this.total=times.length;this.completed=0;this.phase='loading';this.message='';
    return times;
  }
  start(now:number){
    if(this.phase!=='loading'||!this.total)throw Error('Video chưa được kiểm tra để phân tích.');
    this.phase='running';this.startedAt=now;
  }
  advance(completed:number){
    if(this.phase!=='running')return;
    if(!Number.isInteger(completed)||completed<this.completed||completed>this.total)throw Error('Số frame phân tích không hợp lệ.');
    this.completed=completed;
  }
  complete(note:string){
    if(this.phase!=='running'||this.completed!==this.total)throw Error('Phân tích chưa đủ toàn clip.');
    this.phase='ready';this.message=note;
  }
  cancel(){
    if(['reading','loading','running'].includes(this.phase)){
      this.phase='cancelled';this.message='Chưa có kết quả hoàn chỉnh. Có thể chạy lại video.';
    }
  }
  fail(message:string,action:'retry'|'choose'='retry'){
    this.phase='error';this.message=message;this.failureAction=action;
  }
  view(now:number):AnalysisNotice {
    let title='',detail='',action:AnalysisAction=null;
    if(this.phase==='reading'){title='Đang đọc video';detail='Kiểm tra thời lượng và định dạng trước khi tải AI.';action='cancel';}
    if(this.phase==='loading'){title='Đang tải AI';detail=`${this.total.toLocaleString('vi-VN')} khung cần xử lý · lần đầu có thể lâu.`;action='cancel';}
    if(this.phase==='running'){
      title=`Đang phân tích · ${Math.floor(this.completed/this.total*100)}%`;
      const elapsed=Math.max(0,now-this.startedAt),remaining=this.completed>0?Math.ceil((this.total-this.completed)*elapsed/this.completed/1000):null;
      const eta=remaining===null?'Đang xử lý khung đầu':remaining>=60?`còn ≈${Math.ceil(remaining/60)} phút`:`còn ≈${remaining} giây`;
      detail=`${this.completed.toLocaleString('vi-VN')}/${this.total.toLocaleString('vi-VN')} khung · ${eta}`;action='cancel';
    }
    if(this.phase==='ready'){title='Đã phân tích xong';detail=this.message;action='play';}
    if(this.phase==='cancelled'){title='Đã hủy phân tích';detail=this.message;action='retry';}
    if(this.phase==='error'){title='Không xử lý được video';detail=this.message;action=this.failureAction;}
    const actionLabel=action==='cancel'?'Hủy':action==='retry'?'Chạy lại':action==='choose'?'Chọn video':action==='play'?'Phát video':'';
    return {phase:this.phase,visible:this.phase!=='idle',title,detail,completed:this.completed,total:this.total,action,actionLabel};
  }
}
