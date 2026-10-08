/** Source ownership, independent of model readiness. Never stores camera identifiers. */
export class SourceLifecycle {
  private ticket=-1;
  private kind:'camera'|'fixture'|null=null;
  private hidden=false;
  private muted=false;
  private intent=false;
  private blocked=false;
  private resuming=false;
  private state='idle';
  private events:Array<{atMs:number;event:string;state:string}>=[];
  private counts:Record<string,number>={};
  private event(event:string){
    this.counts[event]=(this.counts[event]??0)+1;
    this.events.push({atMs:performance.now(),event,state:this.state});
    if(this.events.length>32)this.events.shift();
  }
  begin(ticket:number,kind:'camera'|'fixture',hidden=false){
    this.ticket=ticket;this.kind=kind;this.hidden=hidden;this.muted=false;
    this.intent=true;this.blocked=false;this.resuming=false;this.state='opening';this.event('begin');
  }
  owns(ticket:number){return this.kind!==null&&ticket===this.ticket;}
  stop(){this.ticket=-1;this.kind=null;this.intent=false;this.resuming=false;this.blocked=false;this.state='stopped';this.event('stop');}
  suspend(reason:'hidden'|'muted',wasPlaying:boolean){
    if(!this.kind)return;
    if(reason==='hidden')this.hidden=true;else this.muted=true;
    this.intent=this.intent||wasPlaying;this.state=reason;this.event(reason);
  }
  available(reason:'hidden'|'muted'){
    if(reason==='hidden')this.hidden=false;else this.muted=false;
    if(this.kind&&!this.hidden&&!this.muted){this.state=this.intent?'waiting-resume':'paused';this.event(`${reason}-cleared`);}
  }
  requestResume(ticket:number,manual=false){
    if(!this.owns(ticket)||this.hidden||this.muted||this.resuming||(!manual&&(!this.intent||this.blocked)))return false;
    this.intent=true;this.resuming=true;this.state='resuming';this.event(manual?'manual-resume':'resume');return true;
  }
  playing(ticket:number){
    if(!this.owns(ticket)||this.hidden||this.muted)return;
    this.intent=false;this.blocked=false;this.state='running';this.event('playing');
  }
  resumed(ticket:number){if(this.owns(ticket))this.resuming=false;}
  playFailed(ticket:number){if(!this.owns(ticket))return;this.resuming=false;this.intent=true;this.blocked=true;this.state='play-blocked';this.event('play-failed');}
  paused(ticket:number){
    // A pause caused by suspension must not erase the previous playing intent.
    if(!this.owns(ticket)||this.hidden||this.muted||this.blocked||this.state!=='running')return;
    if(this.kind==='camera'){this.intent=true;this.blocked=true;this.state='play-blocked';this.event('unexpected-camera-pause');return;}
    this.intent=false;this.state='paused';this.event('manual-pause');
  }
  canCapture(ticket:number){return this.owns(ticket)&&!this.hidden&&!this.muted&&!this.blocked&&this.state==='running';}
  needsGesture(){return this.kind!==null&&this.blocked;}
  notice(){
    if(!this.kind)return null;
    if(this.blocked)return {title:'Camera cần tiếp tục',detail:'Trình duyệt tạm dừng hình ảnh. Bấm Tiếp tục camera; dữ liệu cũ đã hủy.',action:'Tiếp tục camera'};
    if(this.muted)return {title:'Camera đang gián đoạn',detail:'Đang chờ nguồn hình trở lại. Chưa công bố khoảng cách.',action:null};
    return null;
  }
  report(){return {ticket:this.ticket,kind:this.kind,state:this.state,hidden:this.hidden,muted:this.muted,needsGesture:this.blocked,counts:{...this.counts},events:this.events.map(e=>({...e})),scope:'Source lifecycle only; not physical camera or road-distance acceptance'};}
}
