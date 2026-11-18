import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const cwd = fileURLToPath(new URL('..', import.meta.url))
const child = spawn(process.execPath, ['scripts/check-template-discovery-browser.mjs'], { cwd, env: { ...process.env, FUSE_SITE_SMOKE_ONLY: '1' }, stdio: 'inherit', windowsHide: true })
child.on('error', error => { console.error(error); process.exitCode = 1 })
child.on('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1 })
