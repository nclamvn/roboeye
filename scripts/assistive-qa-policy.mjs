// Pure restoration policy. Exact-device discovery is supplied by the caller;
// no process, filesystem, device identifier or historical receipt is touched.
export function boundedDiagnostic(value) {
  return String(value??'').replace(/[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}/g,'[simulator-id]').slice(-2048);
}
export function restoreInitialShutdown({query,shutdown}) {
  const result={restored:false,beforeState:null,afterState:null,queryExitCodes:[],shutdown:null};
  try {
    const before=query();result.queryExitCodes.push(before.exitCode);result.beforeState=before.state??null;
    if(before.exitCode!==0||!before.state){result.reason='Cannot verify exact simulator state; no shutdown attempted.';return result;}
    if(before.state==='Shutdown'){result.restored=true;result.afterState='Shutdown';result.reason='Already Shutdown; independently verified, no mutation needed.';return result;}
    const command=shutdown();result.shutdown={exitCode:command.status??null,signal:command.signal??null,stdout:boundedDiagnostic(command.stdout),stderr:boundedDiagnostic(command.stderr)};
    const after=query();result.queryExitCodes.push(after.exitCode);result.afterState=after.state??null;
    // Exit 149 can be a race with Xcode auto-shutdown. It is not ignored: the
    // exact device must be independently rediscovered in the intended state.
    result.restored=after.exitCode===0&&after.state==='Shutdown';
    result.reason=result.restored?'Post-command exact-device Shutdown verified.':'Restoration not verified; gate remains failed.';
    return result;
  } catch(error){result.reason='Restoration failed with an explicit policy error.';result.error=boundedDiagnostic(error.message);return result;}
}
