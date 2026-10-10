/** No hardware marketing/UA field qualifies a runtime as realtime-capable. */
export class MobileBudget {
  constructor(private scope:'detector'|'joined'='detector'){}
  private samples:number[]=[];
  reset(){this.samples=[];}
  observe(ms:number){if(Number.isFinite(ms)&&ms>=0&&ms<60000){this.samples.push(ms);if(this.samples.length>24)this.samples.shift();}}
  report(){const sorted=[...this.samples].sort((a,b)=>a-b),p95=sorted.length?sorted[Math.ceil(sorted.length*.95)-1]:null;
    return {schema:'mobile-measured-budget-v1',count:sorted.length,p95Ms:p95,limitMs:300,
      state:sorted.length<10?'probing':p95!==null&&p95<=300?'within-budget':'too-slow',
      scope:this.scope==='detector'?'Detector capture-to-result only; depth/accuracy/thermal and physical-device acceptance are separate.':'Same-frame detector/depth capture-to-join including terminal failures; not physical metric accuracy or thermal acceptance.'};}
}
