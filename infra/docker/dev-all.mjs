#!/usr/bin/env node
// Sobe a infraestrutura em Docker (esperando os healthchecks) e, em seguida, inicia
// o front-end (Vite) e a API locais em paralelo. Ctrl+C encerra os processos locais;
// os containers continuam rodando (use `--down` para derruba-los ao sair).
//
// Uso: node infra/docker/dev-all.mjs [--down] [--no-infra]
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const composeFile = resolve(root, 'infra/docker/docker-compose.yml')
const envFile = resolve(root, '.env')
const args = new Set(process.argv.slice(2))
const isWindows = process.platform === 'win32'

const composeArgs = ['compose', '-f', composeFile]
if (existsSync(envFile)) composeArgs.push('--env-file', envFile)

if (!args.has('--no-infra')) {
  console.log('[dev:all] subindo postgres, minio, redis e mailpit...')
  const up = spawnSync('docker', [...composeArgs, 'up', '-d', '--wait'], { cwd: root, stdio: 'inherit' })
  if (up.status !== 0) {
    console.error('[dev:all] falha ao subir a infraestrutura (o Docker esta rodando?).')
    process.exit(up.status ?? 1)
  }
}

// Variaveis do .env da raiz valem tambem para o Vite e a API locais.
if (existsSync(envFile)) process.loadEnvFile(envFile)

const tasks = [
  { name: 'web', args: ['--filter', '@fuse/web', 'run', 'dev'] },
  { name: 'api', args: ['--filter', '@fuse/web', 'run', 'dev:api'] },
]

const children = tasks.map(({ name, args: taskArgs }) => {
  const child = spawn('pnpm', taskArgs, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: isWindows })
  const prefix = (stream, out) =>
    stream.on('data', chunk => {
      for (const line of String(chunk).split(/\r?\n/)) if (line) out.write(`[${name}] ${line}\n`)
    })
  prefix(child.stdout, process.stdout)
  prefix(child.stderr, process.stderr)
  child.on('exit', code => {
    console.log(`[dev:all] ${name} saiu com codigo ${code}`)
    shutdown(code ?? 0)
  })
  return child
})

let stopping = false
function shutdown(code) {
  if (stopping) return
  stopping = true
  for (const child of children) if (child.exitCode === null) child.kill()
  if (args.has('--down')) spawnSync('docker', [...composeArgs, 'down'], { cwd: root, stdio: 'inherit' })
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
