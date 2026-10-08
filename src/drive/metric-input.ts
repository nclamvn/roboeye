/** Worker-owned input storage. Update only after the preceding run completes.
 * Never transfer this buffer; output maps retain their own independent storage. */
export class MetricInputBuffer {
  readonly rgb:Float32Array;
  constructor(readonly width:number,readonly height:number) {
    if(![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=4096))throw Error('Sai kích thước metric input.');
    this.rgb=new Float32Array(3*width*height);
  }
  update(rgba:Uint8ClampedArray,width:number,height:number):Float32Array {
    if(width!==this.width||height!==this.height)throw Error('Sai shape metric frame.');
    const plane=width*height;
    if(rgba.length!==4*plane)throw Error('Sai RGBA metric frame.');
    for(let i=0,j=0;i<plane;i++,j+=4){this.rgb[i]=rgba[j]/255;this.rgb[plane+i]=rgba[j+1]/255;this.rgb[2*plane+i]=rgba[j+2]/255;}
    return this.rgb;
  }
}
