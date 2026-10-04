export interface BrowserModelArtifact {
  file: string;
  bytes: number;
  sha256: string;
  releaseUrl: string;
}

export interface VerifiedModelArtifact {
  bytes: ArrayBuffer;
  source: 'same-origin' | 'release';
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Production deployments do not contain git-ignored model fixtures. Prefer a
 * same-origin staged model for local/offline builds, then use the immutable
 * GitHub Release asset. Both paths are accepted only after byte-size and SHA
 * verification, so a CDN error can never silently become an inference model.
 */
export async function fetchVerifiedModelArtifact(
  base: string,
  directory: string,
  artifact: BrowserModelArtifact,
  fetcher: typeof fetch = fetch,
  onProgress?: (loaded:number,total:number)=>void,
): Promise<VerifiedModelArtifact> {
  const release = new URL(artifact.releaseUrl);
  if (release.protocol !== 'https:' || release.hostname !== 'github.com') throw Error('Model release URL không hợp lệ.');
  const candidates: Array<{url: string; source: VerifiedModelArtifact['source']}> = [
    {url: new URL(`models/${directory}/${artifact.file}`, base).href, source: 'same-origin'},
    {url: release.href, source: 'release'},
  ];
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const response = await fetcher(candidate.url, {credentials: 'omit'});
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      let bytes:ArrayBuffer;
      if(onProgress&&response.body){
        const reader=response.body.getReader(),buffer=new Uint8Array(artifact.bytes);let loaded=0;
        onProgress(0,artifact.bytes);
        try{
          for(;;){const {done,value}=await reader.read();if(done)break;if(loaded+value.byteLength>artifact.bytes)throw Error('model lớn hơn contract');buffer.set(value,loaded);loaded+=value.byteLength;onProgress(loaded,artifact.bytes);}
        }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
        if(loaded!==artifact.bytes)throw Error(`sai kích thước ${loaded}`);bytes=buffer.buffer;
      }else bytes=await response.arrayBuffer();
      if (bytes.byteLength !== artifact.bytes) throw Error(`sai kích thước ${bytes.byteLength}`);
      const hash = hex(await crypto.subtle.digest('SHA-256', bytes));
      if (hash !== artifact.sha256) throw Error('sai SHA-256');
      return {bytes, source: candidate.source};
    } catch (error) {
      failures.push(`${candidate.source}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw Error(`Không tải được model đã kiểm chứng (${failures.join('; ')}).`);
}
