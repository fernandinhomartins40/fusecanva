# API local

Execute `npm.cmd run server` na pasta `web/`. O serviço escuta apenas em `127.0.0.1:8787`; o Vite encaminha `/api` para esse processo durante desenvolvimento. A base persistente é `.data/studio.sqlite`, ignorada pelo Git. Testes criam bancos `:memory:` separados.

## Rotas

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/documents`, `POST /api/documents`
- `GET /api/documents/:id`, `PUT /api/documents/:id` com `revision` obrigatória; snapshots-base das 100 revisões recentes são mantidos no SQLite para merge de três vias
- `GET|POST /api/documents/:id/permissions`; `DELETE /api/documents/:id/permissions/:userId`
- `GET|POST /api/documents/:id/comments`
- `POST /api/documents/:id/operations` para operações de planilhas, Docs e propriedades de elementos do canvas (`design.element.patch`); operações são idempotentes, alterações disjuntas com revisão-base antiga combinam, sobreposições retornam `409` e o resultado é difundido por SSE
- `GET /api/documents/:id/events` (authenticated Server-Sent Events for document revisions, comment changes and access changes)
- `POST /api/ai/text` (gera um rascunho para documento cloud editável via modo sandbox ou adapter Chat Completions configurado no servidor)
- `GET /api/health`

Papéis: `owner`, `editor`, `commenter` e `viewer`. O proprietário concede acesso a contas já cadastradas ou cria convites pendentes por e-mail/link para projetos e equipes. O envio de e-mail fica desativado por padrão; sem provedor ativo, a API retorna um link de convite de uso único. Comentários podem receber respostas em threads de um nível, vinculadas ao mesmo documento e ao contexto da página/elemento; conversas principais podem ser resolvidas ou reabertas por `PATCH /api/documents/:id/comments/:commentId`. Essas mudanças emitem `comments.updated`. Gravações levam a revisão-base. Se outra sessão salvou primeiro, a API combina alterações independentes usando o snapshot daquela revisão; alterações no mesmo campo devolvem `409`, o snapshot atual e os caminhos em conflito.

### Envio opcional de convites

Para enviar e-mails por Resend, configure `STUDIO_EMAIL_PROVIDER=resend`, `STUDIO_EMAIL_API_KEY`, `STUDIO_EMAIL_FROM` e `STUDIO_PUBLIC_APP_URL` no ambiente do servidor. A URL pública deve usar `http` ou `https`; o adaptador monta o link de aceitação de projeto/equipe nessa origem. Sem essas configurações, o convite continua pendente e a interface oferece o link para compartilhar. Falha de rede, rejeição do provedor ou resposta inválida não apaga o convite. Testes usam um `fetch` simulado ou um adapter injetado e nunca enviam e-mails reais.

## Limites conhecidos

O cliente web já usa estas rotas para autenticação, biblioteca remota, criação/edição de documentos, permissões, comentários, atualização colaborativa por eventos, ponteiros, seleção remota de objetos e seleção de blocos/células Docs. Eventos SSE só são enviados a sessões autenticadas que ainda têm acesso; logout e revogação encerram a sessão de eventos. Planilhas sincronizam valores, formatos, mesclagem/desmesclagem e inclusão de linhas/colunas; Docs sincroniza texto e células de tabela; o canvas sincroniza propriedades dos elementos. Criação, remoção e estrutura/ordem dos elementos ainda usam snapshots/merge de três vias. Ainda falta coedição por operações/CRDT nos demais conteúdos e editores, recuperação/verificação de conta, paginação, limites por usuário, revogação geral de sessões, observabilidade, backup e política operacional. O rate limit de login é em memória e por processo. `node:sqlite` é experimental na versão Node 22.17 usada neste ambiente; esta base local não está aprovada para implantação pública. Configure origens confiáveis em `APP_ORIGINS` e um banco de produção antes de qualquer exposição externa.

### Collaborative video timeline operations

Video timeline clips use `design.video.clip.create`, `design.video.clip.patch`, and `design.video.clip.delete` through `POST /api/documents/:id/operations`. The API validates clip bounds and patch fields, merges stale edits to different clips or fields, rejects overlapping changes with `409`, and publishes replayable events to authorized sessions. The full test suite includes clip create, trim/track/volume/fade changes, conflict rejection, deletion, and SSE replay. This operation path does not mean every editor field is collaborative; document structure and unsupported media properties retain their separately documented behavior.
