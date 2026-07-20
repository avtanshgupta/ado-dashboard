import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const procs = [];

function run(name, cmd, args, cwd, color) {
  const p = spawn(cmd, args, { cwd, shell: process.platform === 'win32' });
  const tag = `\x1b[${color}m[${name}]\x1b[0m`;
  const pipe = (stream, isErr) =>
    stream.on('data', (d) => {
      d.toString()
        .split('\n')
        .filter(Boolean)
        .forEach((line) => process[isErr ? 'stderr' : 'stdout'].write(`${tag} ${line}\n`));
    });
  pipe(p.stdout, false);
  pipe(p.stderr, true);
  p.on('exit', (code) => {
    process.stdout.write(`${tag} exited with code ${code}\n`);
    shutdown();
  });
  procs.push(p);
}

function shutdown() {
  for (const p of procs) {
    try {
      p.kill();
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('Starting ADO PR Dashboard (backend :4000, frontend :5173)…\n');
run('server', 'node', ['src/index.js'], join(root, 'server'), '36');
run('web', 'npm', ['run', 'dev'], join(root, 'web'), '35');

setTimeout(() => {
  console.log('\n  ➜  Open the dashboard:  \x1b[1mhttp://localhost:5173\x1b[0m\n');
}, 2500);
