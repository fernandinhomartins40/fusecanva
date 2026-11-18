# Agentes de implementação — Fuse Studio v2

Data: 17/11/2026 · Executor: Claude Opus 5.5 (orquestrador) lançando subagentes
Base: [02-PLANO-V2.md](02-PLANO-V2.md) · Análise: [01-ANALISE-PONTA-A-PONTA.md](01-ANALISE-PONTA-A-PONTA.md)

---

## 1. Como o orquestrador usa este documento

1. Executar **uma onda por vez**, na ordem 0 → 6. Nunca iniciar uma onda antes de o gate da anterior passar.
2. Na onda, lançar primeiro o **Arquiteto da onda** (contratos). Depois lançar **em paralelo** os agentes de implementação, cada um com `isolation: "worktree"`. Por último, o **Integrador** e o **QA da onda**.
3. Paralelismo recomendado: **até 6 agentes simultâneos**. Agentes da mesma onda sem dependência entre si podem rodar juntos; respeitar a coluna "Depende de".
4. Cada agente recebe o **prompt-base** (§2) + o bloco da sua ficha.
5. Cada agente termina com um PR (branch `wave-N/<ID>`) e um relatório: o que fez, testes executados com saída, o que ficou pendente.
6. O orquestrador só marca a onda como concluída quando o Integrador confirma o **Gate** do plano v2 (§8) com evidência (saída do CI).

---

## 2. Prompt-base (prefixo obrigatório de todo agente)

```text
Você é um engenheiro sênior do Fuse Studio, uma suite de design visual open source,
local-first e auto-hospedável. Leia antes de começar:
- docs/v2/02-PLANO-V2.md (princípios, ADRs, estrutura, DoD)
- docs/adr/*.md (decisões aceitas)
- o README e o index.ts dos pacotes que você vai tocar.

REGRAS INEGOCIÁVEIS
1. Só altere arquivos dos pacotes/pastas listados em "Possui". Para mudar o contrato de outro
   pacote, pare e descreva a mudança no relatório final.
2. Produto próprio: não use nomes, textos, layout, cores, ícones ou assets de terceiros
   (em particular, nada que mencione "Canva", "Dream Lab", "Magic ..."). Identidade = tokens de packages/ui.
3. Fontes de requisito permitidas: as user stories em docs/backlog/ e, quando a ficha citar,
   as sínteses .md do arquivo de pesquisa (classes A/B). É PROIBIDO abrir ou copiar
   código capturado (editor-scripts/, runtime-scripts/, route-bundles/, source-maps/,
   fragments/, *script-sources*) e dumps de sessão (*session*, *.private.*, *.bootstrap.*).
4. TypeScript strict, ESM, sem `any` implícito. Strings de UI via @fuse/i18n (PT-BR e EN).
5. Siga a Definição de Pronto (plano v2, §6): testes unitários + 1 E2E Playwright do fluxo
   principal + acessibilidade (axe) + 360 px mobile.
6. Rode `pnpm turbo run lint typecheck test --filter=<seus pacotes>...` antes de entregar
   e cole a saída no relatório. Não declare sucesso sem saída de teste.
7. Commits pequenos, mensagens em inglês no formato Conventional Commits.
```

---

## 3. Onda 0 — Fundação e higiene

| ID | Agente | Missão | Possui | Entregáveis / Aceite | Depende de |
| --- | --- | --- | --- | --- | --- |
| A0-01 | **Higiene do repositório** | Tirar o corpus de pesquisa do repositório do produto e eliminar riscos | `.gitignore`, `scripts/repo-hygiene/`, raiz | `analysis/`, `visual-references/` e `rea.cmd` fora do Git (movidos para `../fusecanva-research/`, fora do repo); gitleaks sem achados; nenhum arquivo > 5 MB versionado; relatório do que foi movido | — |
| A0-02 | **Correção de encoding** | Corrigir o mojibake (UTF-8 lido como Latin-1) nos `.md`/`.json` e impedir reincidência | `IMPLEMENTATION-*.{md,json}`, `.editorconfig`, `.gitattributes` | Arquivos legíveis; teste de CI que falha em sequências `Ã`/`â€`; `.gitattributes` com `text eol=lf` | — |
| A0-03 | **Arquiteto de monorepo** | Criar pnpm workspaces + Turborepo + TS references + lint de fronteiras; mover `web/` para `apps/web` sem quebrar | raiz, `apps/`, `packages/*/package.json` (esqueleto), `turbo.json`, `tsconfig.base.json` | `pnpm build` e a suíte atual verdes depois do move; esqueleto vazio de todos os pacotes do §3 com `index.ts` | A0-01 |
| A0-04 | **CI/CD** | Pipelines GitHub Actions | `.github/` | Workflows: lint, typecheck, unit, build, Playwright em shards, axe, Lighthouse CI, gitleaks, license-check, cache Turbo; tempo do PR ≤ 15 min | A0-03 |
| A0-05 | **Infra local** | Stack de desenvolvimento conteinerizada | `infra/docker/`, `.env.example` | `docker compose up` com Postgres, MinIO, Redis e Mailpit; healthchecks; script `pnpm dev:all` | A0-03 |
| A0-06 | **Escriba de ADRs** | Redigir os ADR 001–020 com versão estável atual verificada de cada dependência | `docs/adr/` | 20 ADRs no formato MADR, cada um com versão fixada e link oficial | — |
| A0-07 | **Analista de requisitos** | Converter os 131 casos e os 14 domínios em user stories **próprias** (sem nomes, textos ou layout de terceiros) | `docs/backlog/` | `docs/backlog/*.md` por domínio, `US-xxx` com critério de aceite Gherkin; tabela `US ↔ ID do caso original`; priorização MoSCoW | — |
| A0-08 | **Especificador do formato** | Implementar `@fuse/format` | `packages/format` | Schemas Zod de todos os nós/tipos do plano v2 §4; JSON Schema gerado; `migrate()`; (de)serialização zip; **migrador do formato atual** (IndexedDB v3/SQLite) com roundtrip sobre todas as fixtures de `apps/web/tests/fixtures`; cobertura ≥ 90% | A0-03 |
| A0-09 | **Designer de sistema** | Identidade e design system próprios | `packages/ui`, `packages/i18n` | Tokens (cor com contraste AA verificado, tipo, espaço, raio, sombra, movimento), temas claro/escuro, 25 componentes base com Radix, Storybook, axe limpo; i18n com FormatJS | A0-03 |
| A0-10 | **Kit open source** | Arquivos de comunidade | `LICENSE*`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `GOVERNANCE.md`, `.github/ISSUE_TEMPLATE` | Conforme ADR-020; guia "primeiro PR em 15 min" | A0-06 |
| A0-INT | **Integrador da onda 0** | Merge contínuo e gate | — (só merge e correções triviais) | **Gate 0** do plano v2 verificado com saída do CI | todos A0 |

---

## 4. Onda 1 — Núcleo do editor e desmontagem dos monólitos

| ID | Agente | Missão | Possui | Entregáveis / Aceite | Depende de |
| --- | --- | --- | --- | --- | --- |
| A1-ARQ | **Arquiteto da onda 1** | Publicar as APIs públicas de `geometry`, `text`, `renderer`, `editor-core`, `collab`, `api-client` | `packages/*/src/index.ts` (só tipos) | Interfaces e tipos revisados; doc `docs/architecture/editor-core.md` | Gate 0 |
| A1-01 | **Desmontador do front-end** | Fatiar `App.tsx` (638 KB) em `apps/web/features/*` sem mudar comportamento | `apps/web/src` | Nenhum arquivo > 800 linhas; estado global em stores Zustand por domínio; toda a suíte atual verde; relatório do mapa antigo → novo | A1-ARQ |
| A1-02 | **Desmontador do back-end** | Fatiar `server/index.mjs` em módulos Fastify (§7 do plano) | `apps/server` | Módulos `auth, authz, org, docs, media, comments, notifications, audit, sites, print, ai-gateway, plugins`; OpenAPI gerado; 100% dos testes de API atuais verdes | A1-ARQ |
| A1-03 | **Persistência de produção** | SQLite → Postgres (Drizzle) + mídia em S3/MinIO | `apps/server/src/db`, `apps/server/modules/media` | Migrações Drizzle; script de migração SQLite→Postgres; upload multipart pré-assinado; dedup SHA-256 mantido | A1-02 |
| A1-04 | **Geometria** | Matrizes, bounds, hit-test, snapping, guias | `packages/geometry` | Cobertura ≥ 90%; benchmark de hit-test com 20 mil nós ≤ 2 ms | A1-ARQ |
| A1-05 | **Motor de texto** | Shaping HarfBuzz wasm, layout de parágrafo, quebra, kerning, ligaduras, sobrescrito, fontes OFL | `packages/text` | Medição idêntica no navegador e no Node; testes com latim, acentos, árabe e CJK básico | A1-ARQ |
| A1-06 | **Renderer único** | `RenderBackend` Canvas2D/OffscreenCanvas/skia-canvas; desenha todos os nós | `packages/renderer` | Golden images (diff ≤ 0,5%) entre navegador e Node para 40 fixtures; render em Worker | A1-04, A1-05 |
| A1-07 | **Editor core** | Comandos, seleção, ferramentas, viewport (pan/zoom/pinch), atalhos, guias e réguas, multi-seleção, grupos, camadas | `packages/editor-core` | Sem dependência de React; testes de comandos; atalhos documentados | A1-04 |
| A1-08 | **Colaboração CRDT** | Binding Y.Doc ⇄ `@fuse/format`, awareness (cursor, seleção, follow, spotlight), undo por usuário, y-indexeddb, servidor Hocuspocus com auth e persistência Postgres | `packages/collab`, `apps/server/modules/collab` | Teste: 2 clientes + offline 10 min + reconexão sem perda; 3 clientes concorrentes em texto; permissões viewer/commenter respeitadas no servidor | A0-08, A1-03 |
| A1-09 | **Autenticação e autorização** | Auth (senha, magic link, OIDC), ReBAC (`packages/authz`), links públicos, convites | `apps/server/modules/{auth,authz}`, `packages/authz` | ASVS L2 nos fluxos; testes de matriz de permissões (papel × ação × recurso) | A1-02 |
| A1-10 | **Integração do editor de design** | Montar o editor de design em `apps/web` sobre `editor-core` + `renderer` + `collab` | `packages/editor-design` (base) | **Gate 1**: design com shapes, texto, imagem, grupos e camadas coeditado; PNG igual ao editor | A1-06, A1-07, A1-08 |
| A1-QA | **QA da onda 1** | Portar os 74 roteiros CDP para Playwright no `test-kit` | `packages/test-kit` | Roteiros relevantes portados; shards no CI; relatório dos que foram aposentados (substituídos por Yjs) | A1-01 |
| A1-INT | **Integrador da onda 1** | Merge e Gate 1 | — | Gate 1 com evidência | todos A1 |

---

## 5. Onda 2 — Editores de conteúdo (MVP alpha)

| ID | Agente | Missão | Possui | Fontes de requisito (pesquisa, classe A/B) | Aceite principal | Depende de |
| --- | --- | --- | --- | --- | --- | --- |
| A2-ARQ | Arquiteto da onda 2 | Contratos de `editor-doc`, `editor-sheet`, `formula`, `editor-whiteboard`, `io-office`, `io-export` | `index.ts` desses pacotes | — | Contratos publicados | Gate 1 |
| A2-01 | **Designs e apresentações** | Páginas, formatos, notas, modo apresentador, apresentação ao vivo com follow, tela cheia, timer, transições de slide | `packages/editor-design` | `APRESENTACOES-INTERACOES.md`, `CANVA-EDITOR.md`, `GUIAS-REGUAS.md` | E2E criar → apresentar → seguir apresentador em 2 sessões | A2-ARQ |
| A2-02 | **Docs** | Blocos ricos em Y.Text, marcas, listas, tabelas com mesclagem, sumário, localizar/substituir, configuração de página, paginação | `packages/editor-doc` | `DOCS-*.md`, `HISTORICO-DESFAZER-REFAZER.md` | Paginação idêntica no editor e no PDF (mesmo motor de texto) | A2-ARQ |
| A2-03 | **Motor de fórmulas** | Extrair `formula.ts` + ampliar para 300+ funções (matemática, estatística, texto, data, busca, lógica, financeira) | `packages/formula` | `PLANILHAS-CALCULO.md`, `PLANILHAS-RECALCULO-TOKEN.md` | Suíte de conformidade com 1.000+ casos; recálculo incremental de 100 mil células ≤ 200 ms | A2-ARQ |
| A2-04 | **Planilhas (UI)** | Grade virtualizada esparsa em Y.Map, seleção, colar, preencher, formatos, mesclagem, filtros, ordenação, congelar, gráficos, múltiplas abas | `packages/editor-sheet` | `PLANILHAS-*.md`, `sheet-merge-component-contracts.json` | Rolagem a 60 fps em 100 mil linhas; coedição de células | A2-03 |
| A2-05 | **Quadro branco** | Canvas infinito, dock, notas adesivas, conectores ancorados e curvos, desenho/borracha, seções, timer, votação, templates de facilitação | `packages/editor-whiteboard` | `QUADRO-BRANCO-INTERACOES.md`, `whiteboard-*-contracts.json` | 5 mil objetos fluidos; conectores acompanham transformações | A2-ARQ |
| A2-06 | **Office I/O** | DOCX/PPTX/XLSX/CSV import-export sobre `@fuse/format` | `packages/io-office` | `DOCS-TABELAS.md`, `PLANILHAS-CODEC.md` | Roundtrip das fixtures atuais; abre no LibreOffice sem erro (verificação automatizada headless) | A2-ARQ |
| A2-07 | **Export** | PNG/JPG/SVG/PDF vetorial (fontes embutidas e subset), PDF/UA tagged, GIF; job no worker com progresso e cancelamento | `packages/io-export`, `apps/worker/jobs/export` | `EXPORTACAO-VALIDADA.md`, `PDF-OPCOES-AVANCADAS.md`, `RENDER-EXPORT-CROSSWALK.md` | veraPDF aprova PDF/UA; texto selecionável; 20 páginas ≤ 10 s | A1-06 |
| A2-08 | **Projetos e biblioteca** | Home, busca full-text (Postgres tsvector), pastas, favoritos, recentes, compartilhados, lixeira com restauração, modelos próprios | `apps/web/features/projects`, `apps/server/modules/docs` | `PROJETOS-*.md`, `RECURSOS-LIXEIRA.md`, `MODELOS-DESCOBERTA.md` | Busca ≤ 200 ms com 10 mil documentos | A2-ARQ |
| A2-09 | **Comentários e notificações** | Comentários ancorados (nó/página/trecho), threads, menções, resolução, notificações in-app e por e-mail | `apps/web/features/comments`, `apps/server/modules/{comments,notifications}` | `COLABORACAO-PERMISSOES.md` | Tempo real via awareness/WS; e-mail via Mailpit no dev | A2-ARQ |
| A2-10 | **Self-host alpha** | Imagem Docker única, compose de produção, guia | `infra/docker`, `docs/self-host` | — | Instalação limpa em VPS em ≤ 10 min seguindo o guia | A2-07 |
| A2-QA | QA da onda 2 | E2E dos 5 tipos + acessibilidade + mobile | `packages/test-kit` | — | Matriz de fluxos verde | todos |
| A2-INT | Integrador | Gate 2 / release alpha | — | — | **Gate 2** + tag `v0.1.0-alpha` | todos |

---

## 6. Onda 3 — Mídia, marca e imagem

| ID | Agente | Missão | Possui | Fontes (classe A/B) | Aceite principal | Depende de |
| --- | --- | --- | --- | --- | --- | --- |
| A3-ARQ | Arquiteto da onda 3 | Contratos de timeline, image-ops e brand | `index.ts` | — | — | Gate 2 |
| A3-01 | **Timeline de vídeo** | Multifaixa, clipes, trim/split/slip, fades, volume, transições, texto temporizado/legendas, keyframes com easing, preview WebCodecs | `packages/editor-video` | `VIDEO-MIDIA.md`, `AUDIO-*.md`, `media-component-contracts.json` | Preview sincronizado a 30 fps com 3 faixas | A3-ARQ |
| A3-02 | **Render de mídia** | Worker FFmpeg: MP4/WebM/GIF/MP3 com áudio mixado; render dos frames via `renderer` headless | `apps/worker/jobs/media` | `MEDIA-LINHAGEM-EXPORTACAO.md` | 60 s / 3 faixas ≤ 30 s; A/V sincronizados (±1 frame) | A3-01 |
| A3-03 | **Áudio inteligente** | Waveform, detecção de batidas/onsets, sincronizar cortes à batida, normalização | `packages/editor-video/audio` | `AUDIO-SINCRONIZACAO-PRO.md`, `AUDIO-MARCADORES-RITMO.md` | Detecção de BPM ±2 em 20 faixas de teste CC0 | A3-01 |
| A3-04 | **Operações de imagem** | Ajustes, filtros, recorte inteligente, máscara/borracha/restaurar, transparência, inversão; WebGPU com fallback Canvas | `packages/image-ops` | `AJUSTES-IMAGEM.md`, `RECORTE-IMAGEM.md`, `PRO-ESPECIFICACAO-MASCARA.md`, `TRANSPARENCIA-IMAGEM.md` | Não destrutivo; idêntico no editor e no export | A3-ARQ |
| A3-05 | **Remoção de fundo e segmentação** | Modelo aberto (ONNX) on-device + fallback no worker; borracha mágica por clique | `packages/image-ops/segment`, `apps/worker/jobs/segment` | `IMAGENS-PRO.md` | 2 MP ≤ 2 s em GPU integrada; licença do modelo compatível com AGPL | A3-04 |
| A3-06 | **Kits de marca** | Kits por org, cores, fontes (upload com licença), logos, voz, diretrizes, templates de marca, aplicar paleta preservando estrutura, revisão de marca | `packages/brand`, `apps/web/features/brand` | `MARCA-PRO.md`, `MODELOS-MARCA.md`, `VOZ-E-DIRETRIZES.md` | Aplicar kit em design de 20 páginas ≤ 1 s com undo único | A3-ARQ |
| A3-07 | **Animação** | Animações de entrada, saída e ênfase por elemento e página; export em vídeo/GIF | `packages/editor-design/animation` | `ANIMACOES.md` | Mesma curva no preview e no export | A3-02 |
| A3-08 | **Redimensionamento inteligente** | Converter um design para N formatos com reflow por restrições (âncoras, grupos, hierarquia de texto) | `packages/editor-design/resize` | — (diferencial próprio) | 10 formatos-padrão sem sobreposição nem texto cortado nas fixtures | A3-ARQ |
| A3-QA / A3-INT | QA e integrador | — | — | — | **Gate 3** | todos |

---

## 7. Onda 4 — IA, lote, plugins e equipe (Beta)

| ID | Agente | Missão | Possui | Fontes (classe A/B) | Aceite principal | Depende de |
| --- | --- | --- | --- | --- | --- | --- |
| A4-ARQ | Arquiteto da onda 4 | Contratos do ai-gateway, SDK de plugins e org | `index.ts`, `docs/sdk/` | — | — | Gate 3 |
| A4-01 | **AI Gateway** | Providers: OpenAI-compatible, Anthropic, Ollama, ComfyUI/SD; streaming; quotas e políticas por org; logs sem conteúdo; segredos cifrados | `apps/server/modules/ai-gateway` | `IA-OBSERVADA.md`, `AI-COBERTURA-EQUIVALENCIA.md` | Trocar de provider sem mudar o cliente; testes com mocks; nenhum teste chama a rede | A4-ARQ |
| A4-02 | **Assistente no editor** | Composer com anexos e contexto (seleção, página, marca); ações estruturadas (criar, editar nós, reescrever texto, gerar imagem) sempre como comandos desfazíveis | `packages/ai-client`, `apps/web/features/assistant` | `APPS-DETALHES-CONTEXTO-IA.md`, `ai-component-contracts.json` | Prompt → design editável de 1 página com a marca aplicada; undo único | A4-01 |
| A4-03 | **Estúdio de imagem IA** | Geração, variações, edição por máscara, upscale e envio ao editor (nome próprio, nada de "Dream Lab") | `apps/web/features/image-studio` | `IMAGENS-IA.md`, `DREAM-LAB.md` (só como checklist) | Fluxo gerar → refinar → inserir → exportar | A4-01 |
| A4-04 | **Criação em lote** | Fonte CSV/XLSX/planilha interna/API; vínculo de texto, imagem, cor e link; preview por registro; geração no worker; ZIP/PDF | `packages/bulk`, `apps/worker/jobs/bulk` | `BULK-CREATE-RECONSTRUCTION.md`, `CRIAR-EM-LOTE*.md`, `LOTE-*.md` | 1.000 registros ≤ 3 min | A4-ARQ |
| A4-05 | **SDK de plugins** | `@fuse/sdk`: iframe sandbox, RPC tipado, manifest de permissões, nós de plugin, painéis, eventos | `packages/sdk`, `apps/web/plugins/host` | `INTEGRACOES-APPS.md`, `INTEGRATION-BOUNDARIES.md` | Plugin sem a permissão não lê o documento (teste de segurança) | A4-ARQ |
| A4-06 | **Marketplace e plugins de referência** | Catálogo, instalação por org, revisão; plugins QR, Openverse/Unsplash, ícones, gráficos, Drive, Notion | `apps/web/features/marketplace`, `plugins/*` | `APPS-MARKETPLACE-INVENTARIO.md`, `APP-QR-CANVA.md` (checklist) | 6 plugins funcionando via SDK público | A4-05 |
| A4-07 | **Organização e equipe** | Orgs, times, grupos, papéis, convites, SSO SAML/OIDC, verificação de domínio, políticas (upload, IA, apps), auditoria | `apps/web/features/settings`, `apps/server/modules/org` | `CONTA-EQUIPE-PERMISSOES.md`, `EQUIPE-*.md`, `team-settings-component-contracts.json` | SSO com Keycloak no CI; matriz de políticas testada | A4-ARQ |
| A4-08 | **Versões e aprovações** | Versões nomeadas, restaurar, branch de design, diff visual, fluxo de aprovação (solicitar, aprovar, rejeitar, bloquear export) | `apps/web/features/versions`, `apps/server/modules/versions` | `HISTORICO-VERSOES.md`, `APROVACOES-GOVERNANCA.md` | Restaurar versão sem perder a colaboração ativa | A4-ARQ |
| A4-09 | **Checker de acessibilidade** | Contraste, alt, ordem de leitura, tamanho mínimo de texto; correções em lote; bloqueio opcional de export | `packages/editor-design/a11y-check` | `ACESSIBILIDADE-DESIGN.md`, `accessibility-component-contracts.json` | Detecta 100% das falhas das fixtures | A4-ARQ |
| A4-QA / A4-INT | QA e integrador | — | — | — | **Gate 4** + `v0.5.0-beta` | todos |

---

## 8. Onda 5 — Publicação e canais

| ID | Agente | Missão | Possui | Fontes (classe A/B) | Aceite principal | Depende de |
| --- | --- | --- | --- | --- | --- | --- |
| A5-01 | **Editor de sites** | Páginas, seções, navegação, breakpoints, SEO, formulários, preview mobile/desktop | `packages/editor-site` | `EDITOR-SITES.md`, `SITES-*.md`, `website-editor-component-contracts.json` | Lighthouse ≥ 95 no site gerado | Gate 4 |
| A5-02 | **Publicação e hospedagem** | Build estático, deploy em storage + CDN, subdomínio, domínio próprio com HTTPS (ACME), analytics sem cookies | `apps/server/modules/sites`, `apps/worker/jobs/publish` | `GERENCIAR-LINKS.md` | Domínio próprio com TLS automático em staging | A5-01 |
| A5-03 | **Impressão** | Preflight (sangria, DPI, CMYK, fontes), PDF/X-4, catálogo por adapter, checkout sandbox → real | `apps/web/features/print`, `apps/server/modules/print` | `IMPRESSAO-CATALOGO.md`, `print-component-contracts.json` | PDF/X-4 aprovado em validador; pedido sandbox ponta a ponta | Gate 4 |
| A5-04 | **Marketing e planejador** | Calendário de conteúdo, agendamento de posts por adapters, links gerenciados, UTM | `apps/web/features/planner`, `apps/server/modules/social` | `PLANEJADOR-CONTEUDO.md`, `MARKETING-HUB.md` | Post agendado e publicado num provider sandbox | Gate 4 |
| A5-05 | **Compartilhamento público** | Link de visualização, embed, apresentação pública, QR de compartilhamento | `apps/web/features/share` | `COMPARTILHAMENTO-AUTORIZACAO.md`, `design-sharing-component-contracts.json` | Embed responsivo; revogação imediata | Gate 4 |
| A5-QA / A5-INT | QA e integrador | — | — | — | **Gate 5** | todos |

---

## 9. Onda 6 — Endurecimento e GA

| ID | Agente | Missão | Aceite |
| --- | --- | --- | --- |
| A6-01 | **Desempenho** | Perfilar e otimizar contra os orçamentos do §5 do plano; code splitting por editor | Todos os orçamentos verdes no Lighthouse CI e nos benchmarks |
| A6-02 | **Carga e resiliência** | k6 com 1.000 sessões colaborativas; chaos (queda de Redis/WS); backups | p95 de colaboração ≤ 150 ms; recuperação sem perda |
| A6-03 | **Segurança** | ASVS L2, ZAP, Semgrep, pentest do sandbox de plugins e do upload; modelo de ameaças | Zero achados altos abertos |
| A6-04 | **Acessibilidade** | Auditoria manual + automatizada de todas as rotas; leitores de tela (NVDA/VoiceOver) | WCAG 2.2 AA documentado |
| A6-05 | **Self-host GA** | Helm chart, backup/restore, upgrade entre versões, observabilidade (OTel) | Upgrade 0.5 → 1.0 sem perda |
| A6-06 | **Documentação** | Guia do usuário PT-BR/EN, especificação `.fuse`, docs do SDK, site do projeto | Docs publicados |
| A6-07 | **Release** | Changelog, versionamento semântico, artefatos assinados, anúncio | Tag `v1.0.0` |

---

## 10. Resumo quantitativo

| Onda | Agentes | Paralelismo útil | Saída |
| --- | ---: | ---: | --- |
| 0 | 11 | 6 | Fundação + higiene |
| 1 | 14 | 6 | Núcleo + monólitos desmontados |
| 2 | 13 | 6 | **Alpha** (5 editores) |
| 3 | 10 | 5 | Mídia, marca e imagem |
| 4 | 11 | 6 | **Beta** (IA, plugins, equipe) |
| 5 | 7 | 5 | Publicação |
| 6 | 7 | 5 | **GA 1.0** |
| **Total** | **73** | — | — |

---

## 11. Modelo de ficha para lançar um agente

```text
<PROMPT-BASE do §2>

ID: A2-02 — Docs
Missão: <copiar da ficha>
Possui (único escopo de escrita): packages/editor-doc
Leia: docs/backlog/docs.md (US-2xx), docs/architecture/editor-core.md,
      packages/editor-doc/src/index.ts (contrato do A2-ARQ),
      pesquisa (classe A): DOCS-TABELAS.md, DOCS-MESCLAGEM-CELULAS.md, DOCS-REORGANIZAR-LINHAS.md
Aceite: <copiar da ficha> + DoD do plano v2 §6
Entrega: PR na branch wave-2/A2-02 + relatório com a saída de
         `pnpm turbo run lint typecheck test --filter=@fuse/editor-doc...`
```

> **Nota ao orquestrador:** se uma ficha exigir uma mudança de contrato fora do "Possui", o agente deve parar e reportar. O orquestrador repassa ao Arquiteto da onda, que atualiza o contrato e relança os agentes afetados.
