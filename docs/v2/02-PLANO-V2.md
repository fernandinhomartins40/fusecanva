# Plano de Implementação v2 — Fuse Studio

Data: 17/11/2026 · Substitui: `IMPLEMENTATION-PLAN.md` (v1, arquivado como histórico)
Base: [01-ANALISE-PONTA-A-PONTA.md](01-ANALISE-PONTA-A-PONTA.md) · Execução: [03-AGENTES-OPUS.md](03-AGENTES-OPUS.md)

---

## 1. Visão

> **Fuse Studio é a suite de design visual aberta, local-first e auto-hospedável.** Permite criar designs, documentos, apresentações, quadros, planilhas, vídeos e sites com colaboração em tempo real, IA com a sua própria chave ou modelo local, e um formato de arquivo aberto, sem lock-in.

### 1.1 Princípios (decidem qualquer dúvida)

1. **Produto próprio, não réplica.** O corpus `analysis/` informa *o que* o usuário precisa fazer, nunca *como* parece. A identidade visual, os nomes e a microcopy são próprios.
2. **Aberto por padrão.** Formato `.fuse` documentado, API pública, plugin SDK e self-host.
3. **Local-first.** Toda edição funciona offline. A nuvem sincroniza e não é pré-requisito.
4. **Um modelo, um renderer.** O mesmo código desenha o editor, o export e o render headless.
5. **Colaboração sem conflitos visíveis.** CRDT em todos os tipos de documento; nunca mostrar "conflito 409" ao usuário.
6. **Acessível e mobile desde o primeiro commit.** WCAG 2.2 AA é gate de merge.
7. **Pronto = valor ao usuário + qualidade medida.** Paridade de pixel com terceiros não é critério.

### 1.2 Fora de escopo (por decisão, não por esquecimento)

- Apps nativos iOS/Android: na v2 o PWA cobre; os nativos são avaliados depois do GA.
- Banco de imagens/vídeos stock próprio: integramos provedores abertos (Unsplash, Pexels, Openverse) via plugin.
- Gráfica própria: integramos fulfillment por adapter (ex.: Printful, Gelato ou gráfica local via e-mail/PDF-X).

---

## 2. Decisões de arquitetura (ADRs)

> Os agentes da Onda 0 registram cada ADR em `docs/adr/` e **verificam a versão estável atual** de cada dependência antes de fixá-la.

| ADR | Decisão | Motivo | Alternativa rejeitada |
| --- | --- | --- | --- |
| 001 | **Monorepo pnpm + Turborepo** | Fronteiras de pacote = fronteiras de agente; cache de build | Repo único plano (estado atual) |
| 002 | **TypeScript strict em tudo**, ESM | Consistência; tipos compartilhados cliente/servidor | JS + `.d.mts` avulsos |
| 003 | **Modelo de documento em Zod → JSON Schema**, com `schemaVersion` e migrações puras | Formato aberto validável; plugins e API usam o mesmo contrato | Tipos TS soltos |
| 004 | **CRDT Yjs** para todo documento; provider **Hocuspocus** (WebSocket) no servidor; `y-indexeddb` no cliente | Coedição, offline e undo por usuário resolvidos; elimina o rebase artesanal | Manter OT/rebase próprio (custo linear por feature) |
| 005 | **Renderer próprio sobre Canvas 2D** com uma interface `RenderBackend` (Canvas DOM / OffscreenCanvas em Worker / `skia-canvas` no Node) | Um renderer para editor, export e headless; evita a divergência Konva × export | Konva (editor) + canvas próprio (export) |
| 006 | **Texto com motor de layout próprio** sobre HarfBuzz (wasm) + fontes OFL | Kerning, ligaduras, quebra e medição idênticos no editor e no export | Métricas do DOM (divergem do PDF) |
| 007 | **Back-end Node + Fastify**, organizado em módulos de domínio | Performance, plugins e validação por schema | `node:http` monolítico |
| 008 | **Postgres** (Drizzle ORM + migrações) | Produção, multi-tenant, full-text e RLS opcional | SQLite (permanece só como modo "single-user desktop") |
| 009 | **Armazenamento S3-compatível** (MinIO no self-host) com URLs pré-assinadas e content-addressing SHA-256 | Escala; CDN; deduplicação já existente | Disco local |
| 010 | **Redis + BullMQ** para filas; **workers** separados (export, mídia/FFmpeg, IA, thumbnails) | Export pesado fora do navegador; retry/cancelamento/progresso | Export só no cliente |
| 011 | **Auth: Better Auth (ou Lucia-like) + OIDC/SAML** para SSO; sessões em cookie httpOnly | Self-host corporativo precisa de SSO | Auth artesanal |
| 012 | **Autorização: modelo ReBAC simples** (org → team → folder → doc, papéis owner/editor/commenter/viewer + link público) em um único módulo `authz` | Uma fonte de verdade para ACL | Checagens espalhadas |
| 013 | **UI: React 19 + design system próprio** (tokens CSS, Radix primitives para acessibilidade, ícones Lucide) | Acessibilidade de primitives testadas; identidade própria | Componentes ad hoc |
| 014 | **Estado do editor: store por documento (Zustand) derivado do Y.Doc**; React só observa seletores | Acaba com os ~295 `useState` do `App.tsx` | Estado no componente raiz |
| 015 | **Plugins: iframe sandbox + `postMessage` RPC tipado + manifest de permissões** | Segurança; terceiros sem acesso ao DOM/tokens | Plugins in-process |
| 016 | **IA: gateway `ai-gateway`** com providers (OpenAI-compatible, Anthropic, Ollama, ComfyUI/SD local) e políticas de privacidade e quota por org | BYO-key e modelos locais | Provider único |
| 017 | **Vídeo: composição declarativa no modelo + render no worker com FFmpeg** (preview no cliente via WebCodecs) | MP4/WebM fiéis, com áudio, sem travar o navegador | MediaRecorder no cliente |
| 018 | **i18n: ICU MessageFormat (FormatJS)**, PT-BR e EN na v2 | Comunidade global | Strings literais |
| 019 | **Observabilidade: OpenTelemetry** (traces/metrics/logs) + Sentry-compatible opcional | Operar self-host e nuvem | `console.log` |
| 020 | **Licença: AGPL-3.0 para app/servidor, MIT para `@fuse/sdk`, `@fuse/format` e CLI** | Protege contra SaaS fechado derivado; facilita o ecossistema de plugins | MIT em tudo (permite fork fechado) — **decisão final do mantenedor** |

---

## 3. Estrutura do monorepo

```
fuse-studio/
├─ apps/
│  ├─ web/                # PWA React (shell, rotas, editores montados a partir de packages)
│  ├─ server/             # Fastify: API REST + Hocuspocus (collab) + auth
│  ├─ worker/             # BullMQ: export, mídia (FFmpeg), IA, thumbnails, e-mail
│  ├─ docs-site/          # documentação pública (formato, SDK, self-host)
│  └─ cli/                # `fuse` — render/convert/validate headless
├─ packages/
│  ├─ format/             # @fuse/format — schemas Zod, JSON Schema, migrações, (de)serialização .fuse
│  ├─ collab/             # binding Y.Doc ⇄ modelo, awareness/presença, undo por usuário
│  ├─ geometry/           # matrizes, bounding boxes, snapping, hit-test
│  ├─ text/               # shaping HarfBuzz, layout de parágrafos, fontes
│  ├─ renderer/           # RenderBackend + desenho de todos os nós (shape, text, image, path, video frame)
│  ├─ editor-core/        # comandos, seleção, ferramentas, atalhos, viewport (sem React)
│  ├─ ui/                 # design system: tokens, componentes Radix, ícones, temas claro/escuro
│  ├─ editor-design/      # editor de designs/apresentações (React sobre editor-core)
│  ├─ editor-doc/         # Docs
│  ├─ editor-sheet/       # Planilhas + @fuse/formula
│  ├─ formula/            # motor de fórmulas (extraído de formula.ts)
│  ├─ editor-whiteboard/  # Quadro branco
│  ├─ editor-video/       # Timeline vídeo/áudio/animação
│  ├─ editor-site/        # Sites
│  ├─ image-ops/          # filtros, ajustes, máscaras, recorte, remoção de fundo (WebGPU/ONNX)
│  ├─ io-office/          # DOCX/PPTX/XLSX/CSV import-export
│  ├─ io-export/          # PNG/JPG/SVG/PDF(+X/UA)/GIF orquestração (usa renderer)
│  ├─ brand/              # kits de marca, revisão de marca
│  ├─ bulk/               # criação em lote / data merge
│  ├─ ai-client/          # cliente do ai-gateway + UI de composer
│  ├─ sdk/                # @fuse/sdk — API para plugins (iframe RPC)
│  ├─ api-client/         # cliente tipado da API REST (gerado de OpenAPI)
│  ├─ authz/              # regras ReBAC compartilhadas
│  ├─ i18n/               # catálogos PT-BR / EN
│  └─ test-kit/           # fixtures, factories, harness Playwright, golden images
├─ infra/
│  ├─ docker/             # Dockerfiles + docker-compose (postgres, minio, redis, app)
│  └─ helm/               # chart Kubernetes (onda 6)
├─ docs/ (adr/, v2/, format-spec/, self-host/, contributing/)
└─ .github/ (workflows CI, templates de issue/PR, CODEOWNERS)
```

**Regra de ouro:** cada pacote tem **um agente dono por onda**. Dependências entre pacotes só por API pública (`index.ts`); o lint (`eslint-plugin-boundaries` ou equivalente) barra imports profundos.

---

## 4. Modelo de documento `.fuse` (resumo da especificação)

```ts
// @fuse/format — esboço normativo
FuseFile = {
  format: 'fuse', schemaVersion: number,          // migrações puras v(n) → v(n+1)
  id, kind: 'design' | 'presentation' | 'doc' | 'whiteboard' | 'sheet' | 'video' | 'site',
  meta: { title, createdAt, updatedAt, locale, brandKitId?, tags[] },
  pages: Page[],                                  // design/presentation/whiteboard/video/site
  doc?: DocBody,                                  // blocos ricos (doc)
  sheets?: Sheet[],                               // grade esparsa + fórmulas (sheet)
  timeline?: Timeline,                            // faixas, clipes, keyframes (video e animação)
  site?: SiteMeta,                                // páginas, seções, navegação, SEO
  assets: Record<AssetId, AssetRef>,              // sha256, mime, dims, licença, origem
  styles: { colors, textStyles, effects },        // tokens locais + vínculo a kit de marca
  comments?: never                                // comentários vivem no servidor, não no arquivo
}
Node = Frame | Group | Shape | Path | Text | Image | Video | Audio | Sticky | Connector
     | Table | Chart | Embed | QR | PluginNode    // PluginNode: dados opacos validados pelo plugin dono
```

- **Arquivo em disco:** zip com `document.json` + `assets/<sha256>` + `thumbnail.png`.
- **Mapeamento CRDT:** cada `Node` é um `Y.Map`; listas ordenadas (páginas, filhos, blocos) usam `Y.Array` com IDs estáveis; texto usa `Y.Text` com marcas como atributos.
- **Compatibilidade:** importador do formato atual (IndexedDB v3 e documentos SQLite) para `.fuse` v1, com teste de roundtrip sobre todas as fixtures existentes.

---

## 5. Requisitos não funcionais (orçamentos e gates)

| Métrica | Orçamento | Como medir |
| --- | --- | --- |
| Carga inicial do editor (desktop, cache frio, 4G rápido) | ≤ 2,5 s LCP; JS inicial ≤ 350 KB gz | Lighthouse CI |
| Interação no canvas (mover/escalar 500 nós) | p95 ≤ 16 ms/frame | benchmark Playwright + `performance.measure` |
| Documento grande | 200 páginas / 20 mil nós abre em ≤ 4 s | benchmark fixture |
| Latência de colaboração (mesma região) | p95 ≤ 150 ms de edição remota visível | teste de carga k6 + Hocuspocus |
| Offline | 100% das edições offline sincronizam sem perda depois de 24 h | teste de soak |
| Export PDF de 20 páginas | ≤ 10 s no worker | fila de testes |
| Acessibilidade | 0 violações axe "serious/critical"; navegação completa por teclado | axe + Playwright |
| Mobile | Todas as rotas usáveis a 360 px; alvos ≥ 44 px | Playwright mobile |
| Segurança | OWASP ASVS L2 nos módulos auth/authz/upload/plugins; dependências sem CVE alta | ZAP + `pnpm audit` + Semgrep |
| Cobertura de testes | `packages/*` ≥ 80% linhas; editores ≥ 60% + E2E por fluxo | c8/vitest |

---

## 6. Definição de Pronto (DoD) — por feature

Uma feature só está pronta quando:

1. **Fluxo completo:** UI → comando → Y.Doc → persistência → reabrir → export, com estados vazio, carregando, erro e cancelamento.
2. **Colaboração:** funciona com 2 usuários simultâneos e offline→online (teste automatizado no `test-kit`).
3. **Undo/redo** por usuário correto.
4. **Acessível:** teclado, foco visível, rótulos, leitor de tela (axe limpo).
5. **Responsivo:** 360 px, 768 px e 1280 px+.
6. **i18n:** sem strings literais; PT-BR + EN.
7. **Testes:** unitários no pacote + 1 E2E Playwright do fluxo principal + golden image quando houver render.
8. **Docs:** entrada no guia do usuário e, se tocar o formato ou o SDK, na especificação.
9. **Sem referência a marcas de terceiros** em código, UI ou assets.

O corpus `analysis/` é usado **só** como checklist de completude: cada um dos 131 casos é reescrito como user story própria (Onda 0, agente A0-07) e entra no backlog. "Atende" significa passar no DoD acima, não paridade de pixel.

---

## 7. Mapa de migração do código atual → pacotes

| Hoje (`web/src`, `web/server`) | Destino v2 | Estratégia |
| --- | --- | --- |
| `formula.ts`, `sheet*.ts`, `sheet-charts.ts`, `sheet-dates.ts` | `packages/formula`, `packages/editor-sheet` | Mover + adaptar à grade Y.Map esparsa |
| `docx-*.ts`, `pptx-*.ts`, `excel.ts`, `csv.ts` | `packages/io-office` | Mover; trocar entrada/saída para `@fuse/format` |
| `export.ts`, `svg-export.ts`, `doc-svg-export.ts`, `gif-export.ts`, `pdf-test-renderer.ts` | `packages/io-export` + `packages/renderer` | Reescrever o desenho no renderer único; manter testes como golden |
| `video-composition.ts`, `video-export.ts`, `audio-waveform.ts` | `packages/editor-video` + `apps/worker` (FFmpeg) | Geometria mantida; export para o worker |
| `image-*.ts` | `packages/image-ops` | Mover; acelerar com WebGPU quando disponível |
| `drawing-tools.ts`, `whiteboard*.ts`, `WhiteboardToolDock.tsx` | `packages/editor-whiteboard` | Mover |
| `text-merge.mjs`, `collaboration.ts`, `document-merge.mjs`, `sse-lifecycle.mjs`, `presence-state.mjs` | **Substituídos** por `packages/collab` (Yjs) | Aposentar depois da paridade de testes |
| `persistence.ts` (IndexedDB) | `packages/collab` (y-indexeddb) + migrador | Migrador v3 → `.fuse` |
| `brand-*.mjs`, `BrandAssistantReview.tsx` | `packages/brand` | Mover |
| `bulk-create.mjs`, `BulkCreatePanel.tsx` | `packages/bulk` | Mover |
| `dream-lab.mjs`, `ai-*.mjs`, `AI*.tsx` | `packages/ai-client` + `apps/server/modules/ai-gateway` | Renomear produto (sem "Dream Lab") |
| `apps-catalog.mjs`, `app-adapters.mjs`, `AppsMarketplace.tsx` | `packages/sdk` + `apps/web/plugins` | Converter em plugins reais do SDK |
| `Team*.tsx`, `team-*.mjs` | `apps/web/features/settings` + `apps/server/modules/org` | Mover |
| `PrintSandbox.tsx`, `print-sandbox.mjs` | `apps/web/features/print` + `server/modules/print` | Mover |
| `App.tsx` (638 KB) | Fatiado em `apps/web/features/*` + `packages/editor-*` | **Desmontagem guiada** (agente A1-01) |
| `server/index.mjs` (278 KB) | `apps/server/modules/{auth,authz,org,docs,media,comments,notifications,audit,sites,print,ai-gateway,plugins}` | Desmontagem guiada (A1-02) com testes de API como rede de segurança |
| 83 testes `node --test` + 74 roteiros CDP | `vitest` por pacote + Playwright em `test-kit` | Portar, não descartar |

---

## 8. Roadmap em ondas

As ondas são sequenciais. Dentro de cada onda os agentes rodam **em paralelo**. Cada onda termina com um **gate**: CI verde + revisão do agente integrador + demo do fluxo.

### Onda 0 — Fundação e higiene (pré-requisito de tudo)

| Entrega | Detalhe |
| --- | --- |
| Higiene do repositório | `analysis/` sai do repositório para um arquivo privado; `.gitignore` reforçado; varredura de segredos (gitleaks) no histórico; correção do mojibake nos `.md`/`.json` |
| Monorepo | pnpm workspaces + Turborepo + TS project references + lint de fronteiras |
| CI | GitHub Actions: lint, typecheck, unit, build, Playwright (shard), axe, Lighthouse CI, gitleaks, licença de dependências |
| Infra local | `docker compose` com Postgres, MinIO, Redis e Mailpit; `.env.example` completo |
| ADRs 001–020 | Escritos e aceitos |
| Especificação `.fuse` v1 | `packages/format` com schemas, JSON Schema publicado e migrador do formato atual |
| Design system v0 | Tokens próprios (cor, tipo, espaço, raio, sombra, movimento), tema claro/escuro, 25 componentes base |
| Backlog | 131 casos reescritos como user stories próprias + itens dos 14 domínios |
| Open source | LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, templates de issue/PR, CODEOWNERS |

**Gate 0:** `pnpm i && pnpm build && pnpm test` verdes no CI; `docker compose up` sobe a stack; spec `.fuse` publicada.

### Onda 1 — Núcleo do editor e desmontagem dos monólitos

- `geometry`, `text` (HarfBuzz), `renderer` (Canvas2D + OffscreenCanvas + skia-canvas), `editor-core` (comandos, seleção, ferramentas, viewport, atalhos, snapping, guias e réguas).
- `collab`: binding Y.Doc ⇄ modelo, awareness (cursores, seleção, follow e spotlight), undo por usuário, `y-indexeddb`.
- `apps/server`: Fastify modular, auth (e-mail+senha, magic link, OIDC), authz ReBAC, docs CRUD, Hocuspocus com persistência Postgres, mídia S3 com upload multipart.
- Desmontagem de `App.tsx` e `server/index.mjs` nos destinos do §7, com a suíte atual verde.

**Gate 1:** editor de design com shapes, texto, imagem, grupos e camadas renderiza igual no editor, em PNG e no headless (diff de golden ≤ 0,5%). Dois usuários coeditam offline/online sem perda.

### Onda 2 — Editores de conteúdo

Paralelo: `editor-design` + apresentações (notas, apresentador, ao vivo); `editor-doc` (blocos, marcas, tabelas, mesclagem, sumário, localizar/substituir, configuração de página); `editor-sheet` + `formula` (grade esparsa, 300+ funções, gráficos, filtros, formatação); `editor-whiteboard` (dock, notas adesivas, conectores ancorados, desenho, templates de facilitação, timer, votação); `io-office` (DOCX/PPTX/XLSX/CSV); `io-export` (PNG/JPG/SVG/PDF vetorial com fontes embutidas, GIF); Projetos (busca full-text, pastas, favoritos, lixeira, recentes, compartilhados).

**Gate 2 = MVP público (alpha).** Cinco tipos de documento com criar → editar → coeditar → exportar → reabrir. Self-host funcional.

### Onda 3 — Mídia, marca e imagem

`editor-video` (timeline multifaixa, split, slip, trim, fades, transições, keyframes com easing, legendas/texto temporizado, sincronização com batida via detecção de onsets) + worker FFmpeg (MP4/WebM/GIF com áudio); `image-ops` (ajustes, filtros, recorte inteligente, máscara/borracha, **remoção de fundo on-device** com modelo aberto ONNX/WebGPU e fallback no worker); `brand` (kits, paletas, fontes, voz, diretrizes, templates de marca, revisão de marca, aplicação de paleta preservando estrutura); animações de página e elemento; **redimensionamento inteligente** (reflow de layout para outros formatos).

**Gate 3:** vídeo de 60 s com 3 faixas + áudio exporta em MP4 ≤ 30 s no worker; remoção de fundo local em ≤ 2 s numa imagem de 2 MP em GPU integrada.

### Onda 4 — IA, lote, plugins e equipe

`ai-gateway` (texto, imagem, edição de imagem, upscale, transcrição; providers OpenAI-compatible, Anthropic, Ollama, ComfyUI; políticas por org; quotas; logs sem conteúdo); assistente contextual no editor (gera e edita design/doc com consciência da marca; ações sempre revisáveis e desfazíveis); `bulk` (CSV/XLSX/Sheets → N designs; vínculo de texto, imagem e cor; preview; export em lote no worker); `sdk` + marketplace comunitário (manifest, permissões, revisão, instalação por org; plugins de referência: QR, Unsplash/Openverse, gráficos, ícones, Google Drive, Notion); organização e equipe (papéis, grupos, convites, SSO SAML/OIDC, verificação de domínio, políticas, auditoria, aprovações de design, comentários/menções/notificações, histórico de versões com nomear/restaurar/branch/diff visual).

**Gate 4 = Beta.** Org com SSO, 3 plugins de terceiros instaláveis, IA funcionando com provider local (Ollama) e remoto.

### Onda 5 — Publicação e canais

`editor-site` (páginas, seções, navegação, responsivo, SEO, formulários simples, publicação estática em domínio próprio/subdomínio, analytics leve sem cookies); impressão (preflight: sangria, resolução, CMYK, fontes; **PDF/X**; catálogo de produtos por adapter; checkout em sandbox e depois real); marketing (planejador de conteúdo com calendário; agendamento de posts por adapters; links gerenciados); compartilhamento público (link de visualização, incorporação, apresentação pública).

**Gate 5:** site publicado com HTTPS em domínio próprio; PDF/X-4 aprovado em validador; post agendado num provider sandbox.

### Onda 6 — Endurecimento e GA

Desempenho contra os orçamentos do §5; teste de carga (1.000 sessões colaborativas); auditoria de segurança (ASVS L2, pentest do sandbox de plugins); auditoria de acessibilidade completa; chart Helm + guia de self-host + backup/restore; telemetria opt-in; documentação do usuário PT-BR/EN; site do projeto; release 1.0 com changelog e política de versionamento semântico do formato.

**Gate 6 = GA 1.0.**

---

## 9. Cobertura das 27 áreas auditadas → ondas

| Área | Onda | Área | Onda |
| --- | --- | --- | --- |
| 01 Cliente e dependências | 0–1 | 15 Marca e projetos | 2 (projetos), 3 (marca) |
| 02 Documento A4 | 1–2 | 16 Apps e integrações | 4 |
| 03 Texto | 1 | 17 IA | 4 |
| 04 Histórico | 1 (undo), 4 (versões) | 18 Impressão e marketing | 5 |
| 05 Transformações | 1 | 19 Acessibilidade | todas (gate) |
| 06 Persistência | 1 | 20 Sistema visual | 0 (próprio) e todas |
| 07 Sincronização | 1 | 21 Premium | 4 (quotas/planos opcionais na instância hospedada) |
| 08 Protocolo | 1 (Yjs, aberto) | 22 Imagens Pro | 3 |
| 09 Exportação | 2–3 | 23 Desempenho | 0 (orçamentos), 6 (gate) |
| 10 Docs | 2 | 24 Autenticação e autorização | 1, 4 (SSO) |
| 11 Apresentações | 2 | 25 Backend e infraestrutura | 0–1, 6 |
| 12 Quadros brancos | 2 | 26 Mobile e desktop | todas (PWA) |
| 13 Planilhas | 2 | 27 Sites | 5 |
| 14 Vídeo e áudio | 3 | — | — |

Também entram domínios observados mas ausentes das 27 áreas: **Planejador de conteúdo, Links gerenciados, Aprendizado/Design School** (substituído por tutoriais interativos dentro do app), **Aprovações e governança**, **Lixeira e recuperação**.

---

## 10. Governança de execução

- **Branching:** `main` protegida; cada agente trabalha em worktree/branch `wave-N/<agent-id>`; PR com CI verde + revisão do integrador da onda.
- **Contratos primeiro:** antes da onda, o arquiteto publica as interfaces públicas (`index.ts` + tipos) de cada pacote. Os agentes implementam contra elas.
- **Sem edição cruzada:** um agente só altera arquivos dos pacotes que possui; mudanças de contrato passam por issue para o arquiteto.
- **Ritmo:** cada onda tem um integrador que faz merge contínuo, resolve conflitos e mantém o gate.
- **Rastreabilidade:** cada PR referencia as user stories (`US-xxx`) e, quando aplicável, o ID do caso original do corpus (só o ID, nunca conteúdo capturado).

---

## 11. Riscos principais

| Risco | Prob. | Impacto | Mitigação |
| --- | --- | --- | --- |
| Migração para Yjs quebra features existentes | Média | Alto | Portar testes de colaboração antes; feature flag por tipo de documento; migrador com roundtrip |
| Renderer único demora mais que o previsto | Média | Alto | Começar por shapes/texto/imagem; manter export antigo atrás de flag até o golden passar |
| Escopo de vídeo (FFmpeg/WebCodecs) | Alta | Médio | MVP de vídeo na Onda 3 com transições limitadas; ampliar depois do GA |
| Modelos de IA locais pesados | Média | Médio | On-device opcional; worker com GPU opcional; remoto BYO-key |
| Contribuidores externos sem contexto | Alta | Médio | ADRs, `CONTRIBUTING`, issues "good first issue" por pacote, docs de arquitetura |
| Questões de PI | Baixa (com a higiene) | Muito alto | Repositório limpo, identidade própria, revisão de nomes e assets no CI |

---

## 12. Desvios da Onda 0

Registrados pelo A0-03 (arquiteto de monorepo) em 18/11/2026.

| # | Desvio | Motivo | Quem resolve |
| --- | --- | --- | --- |
| D0-01 | **`web/server` continua em `apps/web/server`**, sem ir para `apps/server`. | `server/document-merge.mjs` importa `../src/text-merge.mjs`, e 20 roteiros e testes importam `../server/*.mjs`. Separar agora quebraria a suíte. Não foi criado esqueleto de `apps/server`. | A1-02 (desmontador do back-end) |
| D0-02 | **`apps/web` não herda `tsconfig.base.json`.** Os tsconfigs do web passaram a usar `strict: true` (0 erros), mas as opções extras da base (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `nodenext`) geram cerca de 846 erros. | Evitar mudança de comportamento antes da desmontagem do `App.tsx`. | A1-01 |
| D0-03 | **Lockfile refeito.** O `package-lock.json` do web foi substituído por `pnpm-lock.yaml`. Os intervalos `^` foram reavaliados (por exemplo, vite 8.3.4 → 8.3.8). `pngjs` foi declarado como devDependency do web porque os roteiros visuais já o usavam como dependência transitiva. O `overrides.uuid` foi para o `pnpm-workspace.yaml`. | O pnpm isola o `node_modules`, e um lockfile npm ao lado do pnpm causaria divergência. | — |
| D0-04 | **O diretório `web/` vazio pode continuar na raiz.** | O Windows travou a remoção porque havia um processo com o cwd dentro dele. O conteúdo foi movido com `robocopy /MOVE`. O Git ignora diretórios vazios. Pode ser apagado quando nenhum processo o usar. | qualquer um (trivial) |
| D0-05 | **O lint de fronteiras usa um script próprio (`tooling/check-boundaries.mjs`, rodado no `pnpm lint`)** em vez do `eslint-plugin-boundaries`. | O web usa oxlint, e adotar ESLint só para isso duplicaria o lint. O script barra imports profundos `@fuse/x/src`, imports relativos que cruzam pacotes e pacotes que importam apps. | A0-04 pode trocar no CI |
| D0-06 | **O pnpm vem do corepack** (`packageManager: pnpm@10.34.9`). O `corepack enable` global falhou com EPERM em `C:\Program Files\nodejs`. Foi usado `corepack enable --install-directory %APPDATA%\npm pnpm`. Com o pnpm 12 via corepack 0.33, o binário não foi encontrado. | Ambiente Windows sem administrador. | — |
| D0-07 | **Licenças nos `package.json` seguem a recomendação do ADR-020:** MIT em `format`, `sdk` e `cli`, AGPL-3.0-only no resto. | A decisão final é do mantenedor. Se mudar, basta trocar o campo `license`. | mantenedor / A0-10 |
