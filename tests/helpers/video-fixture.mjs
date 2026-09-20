/**
 * Produce a small deterministic WebM entirely inside Chromium. The fixture is
 * intentionally visual-only: browser control/layout tests need decoded video
 * geometry, not private road footage or perception quality evidence.
 */
export async function createSyntheticVideo(page, { width = 640, height = 360, frames = 18 } = {}) {
  const base64 = await page.evaluate(async ({ width, height, frames }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(15);
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start();
    for (let frame = 0; frame < frames; frame += 1) {
      const horizon = Math.round(height * .43);
      context.fillStyle = '#9fc0d4';
      context.fillRect(0, 0, width, horizon);
      context.fillStyle = '#48545d';
      context.fillRect(0, horizon, width, height - horizon);
      context.strokeStyle = '#f7f1d1';
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(width * .44, height);
      context.lineTo(width * .49, horizon);
      context.moveTo(width * .69, height);
      context.lineTo(width * .54, horizon);
      context.stroke();
      context.fillStyle = '#18242c';
      const offset = frame * 2;
      context.fillRect(width * .49 + offset, height * .58, width * .12, height * .16);
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }, { width, height, frames });
  return Buffer.from(base64, 'base64');
}
