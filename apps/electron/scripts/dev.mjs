/* npm run electron:dev: the web app over Vite in the Electron window, for
   live development. Builds the engine first, then keeps rebuilding it as
   packages/engine changes, starts Vite on port 5173 (or uses one already
   running there), waits for it, then starts Electron pointed at it. Saving
   any file in apps/web/public or packages/engine reloads the window by
   itself. Closing the app stops Vite and the engine rebuild. Arguments after `--` go to the app, so
     npm run electron:dev -w @adddots/electron -- C:\path\to\file.pdf
   opens a PDF as a double-click in Explorer would. */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const app = join(here, '..');
const URL_ = process.env.ADDDOTS_DEV_URL || 'http://localhost:5173/';
const WIN = process.platform === 'win32';

async function up() {
  try {
    const r = await fetch(URL_);
    return r.ok;
  } catch {
    return false;
  }
}

const stop = (p) => {
  if (!p || p.exitCode !== null) return;
  if (WIN) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  else p.kill();
};

let vite = null;
let engine = null;
if (!(await up())) {
  const b = spawnSync('npx', ['turbo', 'run', 'build', '--filter=@adddots/engine'], {
    cwd: root,
    stdio: 'inherit',
    shell: WIN,
  });
  if (b.status) process.exit(b.status);
  /* the engine rebuilt on every save; Vite then reloads the window */
  engine = spawn('npm', ['run', 'dev', '-w', '@adddots/engine'], { cwd: root, stdio: 'inherit', shell: WIN });
  vite = spawn('npm', ['run', 'dev', '-w', '@adddots/web'], { cwd: root, stdio: 'inherit', shell: WIN });
  for (let i = 0; !(await up()); i++) {
    if (i > 120 || vite.exitCode !== null) {
      console.error('Vite did not start at ' + URL_);
      stop(engine);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, [app, ...process.argv.slice(2)], {
  cwd: app,
  stdio: 'inherit',
  env: { ...process.env, ADDDOTS_DEV_URL: URL_ },
});
child.on('exit', (code) => {
  stop(engine);
  stop(vite);
  process.exit(code ?? 0);
});
