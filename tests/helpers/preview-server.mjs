import { spawn } from 'node:child_process';

export function startPreview(root, port) {
  return spawn(process.execPath, [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--port', String(port),
    '--strictPort'
  ], {
    cwd: root,
    stdio: 'pipe'
  });
}

export function waitForPreview(server, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      server.stdout.off('data', onData);
      server.stderr.off('data', onData);
      server.off('exit', onExit);
    };
    const onData = (data) => {
      if (!String(data).includes('localhost')) return;
      cleanup();
      resolve();
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`vite preview thoát sớm, code ${code}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`vite preview không lên sau ${timeoutMs / 1000}s`));
    }, timeoutMs);

    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.on('exit', onExit);
  });
}

export async function stopPreview(server, timeoutMs = 5_000) {
  if (server.exitCode != null || server.signalCode != null) return;

  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill('SIGTERM');
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ]);

  if (!stopped && server.exitCode == null && server.signalCode == null) {
    server.kill('SIGKILL');
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 1_000))
    ]);
  }
}
