interface ScreenLock {readonly released:boolean;release():Promise<void>;addEventListener(type:'release',listener:()=>void):void}
type RequestLock=()=>Promise<ScreenLock>;
/** Best effort. One pending request; cancellation also releases late acquisitions. */
export class ScreenAwake {
  private active=false;
  private generation=0;
  private pending=false;
  private lock:ScreenLock|null=null;
  private state='idle';
  private failures=0;
  constructor(private request:RequestLock|null){}
  setActive(active:boolean){
    if(!active){
      if(this.active)this.generation++;
      this.active=false;const lock=this.lock;this.lock=null;this.state='inactive';
      if(lock&&!lock.released)void lock.release().catch(()=>{this.failures++;});return;
    }
    this.active=true;
    if(!this.request){this.state='unsupported';return;}
    if(this.pending||this.lock)return;
    const generation=this.generation;this.pending=true;this.state='requesting';
    void this.request().then(lock=>{
      if(!this.active||generation!==this.generation){void lock.release().catch(()=>{this.failures++;});return;}
      this.lock=lock;this.state='held';lock.addEventListener('release',()=>{if(this.lock===lock){this.lock=null;this.state='released-by-system';}});
    }).catch(()=>{this.failures++;if(generation===this.generation)this.state='denied';})
      .finally(()=>{this.pending=false;
        // A new visible source can have arrived while an old request was pending.
        // Retry only that ownership transition, never a denied/OS-released lock.
        if(this.active&&generation!==this.generation)this.setActive(true);
      });
  }
  report(){return {state:this.state,pending:this.pending,held:!!this.lock&&!this.lock.released,failures:this.failures,scope:'Best-effort screen lock, not a camera availability guarantee'};}
}
