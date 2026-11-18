// Ponto de entrada da API em container.
//
// O servidor atual (apps/web/server/index.mjs) faz `listen(port, '127.0.0.1')`, o que o torna
// inalcancavel de fora do container. Ate o desmonte do back-end (A1-02) expor um HOST
// configuravel, este wrapper troca o host de loopback pelo valor de STUDIO_API_HOST,
// sem alterar o codigo da aplicacao. Remover quando o servidor ler o host do ambiente.
import { Server } from 'node:net'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const serverEntry = resolve(process.env.STUDIO_API_ENTRY ?? 'apps/web/server/index.mjs')
const bindHost = process.env.STUDIO_API_HOST

if (bindHost) {
  const originalListen = Server.prototype.listen
  Server.prototype.listen = function patchedListen(...args) {
    if (typeof args[0] === 'number' && args[1] === '127.0.0.1') args[1] = bindHost
    return originalListen.apply(this, args)
  }
}

// O servidor so inicia quando e o script principal (process.argv[1]).
process.argv[1] = serverEntry
await import(pathToFileURL(serverEntry).href)
