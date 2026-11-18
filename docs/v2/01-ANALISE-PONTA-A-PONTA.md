# Análise de ponta a ponta — Fuse Studio

Data: 17/11/2026
Escopo: corpus de engenharia reversa em `analysis/`, plano v1 (`IMPLEMENTATION-PLAN.md`), status (`IMPLEMENTATION-STATUS.json`), rastreabilidade e código atual em `web/`.

---

## 1. Resumo executivo

1. **O corpus é grande e útil, mas a maior parte não serve como especificação.** São 6,2 GB e 8.090 arquivos. O que tem valor real para construir o produto cabe em menos de 20 MB: 183 sínteses `.md`, 53 contratos de componentes, 248 famílias de componentes e 131 casos funcionais. O restante é captura bruta: bundles JS, source maps, dumps de sessão de até 850 MB e screenshots.
2. **O produto já existe em forma funcional ampla, mas a arquitetura não aguenta escalar.** `web/src/App.tsx` tem **638 KB num único arquivo**, com cerca de 295 `useState`. `web/server/index.mjs` tem **278 KB num único arquivo**, usa SQLite embutido e SSE. A coedição usa um rebase próprio para cada tipo de operação. Quase todas as áreas têm alguma implementação: Docs, planilhas, apresentações, quadro branco, vídeo, sites, marca, lote, IA, apps, equipes e impressão em sandbox.
3. **O plano v1 mede a coisa errada.** O critério de pronto é "equivalência com o Canva", medido por MAE de pixel contra screenshots. Por isso só **2 dos 131 casos** estão "validados" e os outros 129 estão "parciais". O plano virou um log de 320 KB, não um roteiro.
4. **Há riscos legais e de segurança que bloqueiam o open source.** O corpus contém código proprietário capturado do Canva, URLs AWS assinadas (`X-Amz-Credential`), bootstraps de sessão e dados de conta. Nada disso pode ir para um repositório público.
5. **A oportunidade:** reaproveitar o conhecimento comportamental do corpus e cerca de 70% da lógica pura já escrita, como fórmulas, DOCX/PPTX/XLSX, export e composição de vídeo. Por cima disso, reconstruir a fundação: monorepo, modelo de documento versionado, CRDT, servidor modular, Postgres/S3 e workers. O critério de pronto passa a ser **valor ao usuário e qualidade objetiva**, não a semelhança com o Canva.

---

## 2. Inventário do corpus `analysis/`

### 2.1 Números

| Item | Quantidade |
| --- | ---: |
| Arquivos totais | 8.090 |
| Tamanho | ~6,2 GB |
| Sínteses Markdown | 183 |
| Contratos de componentes (`*-component-contracts.json`) | 53 |
| Famílias de componentes | 248 |
| Casos de equivalência funcional | 131 |
| Áreas auditadas | 27 |
| Telas no atlas visual | 360 |
| Instâncias visuais medidas | 12.633 |
| Grupos de cor / grupos tipográficos | 57 / 48 |
| Rótulos de serviço detectados no cliente | 56 |
| Modelos de endpoint observados | 419 (de 2.770 eventos) |
| Arquivos > 20 MB (dumps de sessão) | 12, de 31 MB a 850 MB |

### 2.2 Classificação por valor

| Classe | Exemplos | Valor para o produto | Pode ir para o repo público? |
| --- | --- | --- | --- |
| **A. Sínteses comportamentais** | `CANVA-EDITOR.md`, `DOCS-TABELAS.md`, `QUADRO-BRANCO-INTERACOES.md`, `PLANILHAS-CALCULO.md`, `VIDEO-MIDIA.md`, `MARCA-PRO.md`, `PRO-ESPECIFICACAO-MASCARA.md`, `BULK-CREATE-RECONSTRUCTION.md`, `EDITOR-SITES.md`, `MATRIZ-TRANSICOES.md`, `FILA-FALHA-RECUPERACAO.md` | **Alto**: descrevem fluxos, estados, transições, limites e falhas | Só reescritas como requisitos próprios, sem nomes internos, IDs ou trechos capturados |
| **B. Contratos e casos** | 53 `*-component-contracts.json`, `CRITERIOS-EQUIVALENCIA.md` (131 casos), `component-equivalence-obligations.json` | **Alto**: inventário de componentes, estados e critérios de aceite | Convertidos em user stories e testes próprios |
| **C. Sistema visual medido** | `SISTEMA-VISUAL-CANVA.md`, `OBSERVED-COMPUTED-COLOR-PALETTE.md`, `ATLAS-COMPONENTES-ESTADOS.md`, `visual/` | **Médio**: densidade, espaçamentos e hierarquia | **Não**. Usar só como referência de densidade; a identidade visual tem de ser própria |
| **D. Protocolo e infraestrutura** | `PROTOCOLO-TRANSPORTE.md`, `BACKEND-INFRAESTRUTURA-CANVA.md`, `live-design-static-contract.json` | **Baixo/médio**: confirmam padrões conhecidos (WebSocket binário, presença, follow, spotlight) | Não; não acrescentam nada além do estado da arte público |
| **E. Código capturado** | `editor-scripts/`, `runtime-scripts/`, `route-bundles/`, `source-maps/`, `fragments/`, `*-script-sources-*` | **Nenhum** para um produto próprio | **Nunca**: código proprietário de terceiros |
| **F. Dumps de sessão** | `rea-session-evidence-*.json`, `canva-session.bundle-*.json`, `*.private.json`, `*.bootstrap.private.json` | **Nenhum** | **Nunca**: dados de conta, conteúdo privado e URLs assinadas |
| **G. Scripts do REA** | 651 `prepare-*`, 509 `validate-*`, 445 `inspect-*`, 407 `integrate-*` | Ferramental de pesquisa | Não pertencem ao produto |

**Conclusão:** só as classes A e B alimentam o plano v2, como requisitos reescritos. As classes E, F e G devem sair do repositório do produto. Elas ficam num arquivo privado e local, fora do Git, ou são apagadas.

### 2.3 O que o corpus revela sobre o produto-alvo (domínios funcionais)

Os 56 rótulos de serviço, as 27 áreas e os 53 contratos convergem para **14 domínios funcionais**:

| # | Domínio | Evidência principal no corpus | Capacidades observadas |
| --- | --- | --- | --- |
| D1 | Shell, projetos e organização | `PROJETOS-*.md`, `RECURSOS-LIXEIRA.md`, `RECUPERACAO-PROJETOS.md` | Busca combinada, filtros por tipo/data/dono, pastas, favoritos, lixeira/restauração, links gerenciados |
| D2 | Modelo de documento | `ECOSSISTEMA-CANVA.md`, `WIDGETS-SERIALIZACAO.md`, `CODEC-LISTAS-ESPARSAS.md` | Um envelope comum com variantes (design, doc, apresentação, quadro, planilha) e schema versionado |
| D3 | Editor de canvas | `CANVA-EDITOR.md`, `GUIAS-REGUAS.md`, `POSICAO-IMAGEM.md`, `editor-*-contracts` | Seleção, transformações, grupos, camadas, guias/réguas, zoom, timer, modos (leitura/comentário) |
| D4 | Texto e tipografia | `TIPOGRAFIA-AVANCADA.md`, `ESPACAMENTO-TEXTO.md`, `LIGADURAS-CORPO-TEXTO.md` | Kerning, entrelinha, âncora, sobrescrito, ligaduras, estilos de marca |
| D5 | Docs | `DOCS-*.md` (11 arquivos) | Blocos, tabelas, mesclagem, reordenação, localizar/substituir, sumário, configuração de página, PDF |
| D6 | Planilhas | `PLANILHAS-*.md` (8 arquivos) | Fórmulas, mesclagem, erros, recálculo, codec de grade, gráficos |
| D7 | Apresentações | `APRESENTACOES-INTERACOES.md` | Notas, modo apresentador, popout, tela cheia, ao vivo |
| D8 | Quadro branco | `QUADRO-BRANCO-INTERACOES.md` (36 KB) | Dock de ferramentas, notas adesivas, conectores ancorados, linhas curvas, desenho |
| D9 | Imagem e mídia Pro | `IMAGENS-PRO.md`, `PRO-ESPECIFICACAO-MASCARA.md`, `AJUSTES-IMAGEM.md`, `RECORTE-IMAGEM.md` | Remover fundo, borracha mágica, máscaras, recorte inteligente, filtros, ajustes |
| D10 | Vídeo, áudio e animação | `VIDEO-MIDIA.md`, `AUDIO-*.md`, `ANIMACOES.md` | Timeline multifaixa, split, slip, fades, transições, sincronização com batida, keyframes |
| D11 | Marca | `MARCA-PRO.md`, `MODELOS-MARCA.md`, `VOZ-E-DIRETRIZES.md` | Kits de marca, paletas, fontes, voz, diretrizes, revisão de marca, templates de marca |
| D12 | IA | `IA-OBSERVADA.md`, `IMAGENS-IA.md`, `DREAM-LAB*.md`, `AI-COBERTURA-EQUIVALENCIA.md` | Chat com contexto, geração de texto/imagem, upscale, "Dream Lab", contexto de marca |
| D13 | Colaboração e equipe | `COLABORACAO-PERMISSOES.md`, `COMPARTILHAMENTO-AUTORIZACAO.md`, `CONTA-EQUIPE-PERMISSOES.md`, `HISTORICO-VERSOES.md`, `APROVACOES-GOVERNANCA.md` | Papéis, convites, comentários, menções, presença, follow/spotlight, versões, aprovações, SSO/domínio |
| D14 | Publicação e extensões | `EDITOR-SITES.md`, `SITES-*.md`, `INTEGRACOES-APPS.md`, `APPS-*.md`, `IMPRESSAO-CATALOGO.md`, `MARKETING-HUB.md`, `PLANEJADOR-CONTEUDO.md`, `BULK-CREATE-*.md` | Sites, apps/marketplace, impressão, marketing, planejador, criação em lote, export multi-formato |

### 2.4 Lacunas que o corpus **não** cobre (e que não precisam vir dele)

- O codec do protocolo de sincronização e a resolução de conflitos são desconhecidos (`PROTOCOLO-TRANSPORTE.md`). **Não é preciso descobri-los**: CRDTs abertos, como Yjs ou Automerge, resolvem o problema melhor e com garantias formais.
- Backend, topologia e algoritmos (área 25) estão fora do alcance do cliente. **Não é preciso descobri-los**: a arquitetura v2 é desenhada do zero.
- Impressão, checkout e pedido (área 18) têm só 2 casos e nenhuma execução. Serão requisitos próprios com provedores abertos.
- Desempenho (área 23) não tem medições. Será definido por **orçamentos próprios** (seção 5 do plano v2).
- Mobile nativo (área 26) não tem evidência. A v2 usa PWA responsivo; nativo fica para depois.

---

## 3. Diagnóstico do código atual (`web/`)

### 3.1 Stack

| Camada | Hoje |
| --- | --- |
| Front-end | React 19, Vite 8, TypeScript 6, Konva/react-konva, lucide-react |
| Persistência local | IndexedDB (schema v3, migrações v1→v3) |
| Back-end | `node:http` puro, `node:sqlite`, um único `index.mjs` (278 KB) |
| Tempo real | SSE + operações versionadas com rebase próprio por tipo (`document-merge.mjs`, `text-merge.mjs`) |
| Mídia | Objetos locais endereçados por SHA-256 em `.data/media` |
| Export | jsPDF, gifenc, JSZip (DOCX/PPTX), ExcelJS, MediaRecorder/WebM/MP4 no navegador |
| IA | Adapter OpenAI-compatible (texto e imagem) + sandbox determinístico |
| E-mail | Resend opcional |
| Testes | 83 arquivos `node --test` + 74 roteiros Chromium/CDP |

### 3.2 O que está bom e deve ser preservado

- **Lógica de domínio pura e testada:** `formula.ts` (parser recursivo; PROCV/PROCX/ÍNDICE/CORRESP, SES, SOMASE, datas), `sheet*.ts`, `docx-import/export.ts`, `pptx-import/export.ts`, `excel.ts`, `csv.ts`, `svg-export.ts`, `doc-svg-export.ts`, `gif-export.ts`, `video-composition.ts`, `image-filters/masks/crop/adjustments.ts`, `drawing-tools.ts`, `whiteboard.ts`, `bulk-create.mjs`, `brand-kit.mjs`, `brand-review.mjs`, `qr-code.ts`, `text-merge.mjs`.
- **Disciplina de segurança no servidor:** tokens de convite em SHA-256, expiração em 7 dias, ACL por papel, auditoria de equipe e segredos só no servidor.
- **Adapters de provedores externos** com modo sandbox (`external-providers.mjs` e `EXTERNAL-PROVIDER-CONTRACTS.md`).
- **Cultura de testes de ponta a ponta** com evidência, incluindo mobile em 390 px.

### 3.3 Problemas estruturais (bloqueiam escala e contribuição open source)

| # | Problema | Impacto | Severidade |
| --- | --- | --- | --- |
| P1 | `App.tsx` monolítico (638 KB, ~295 estados) | Ninguém consegue contribuir; agentes paralelos colidem no mesmo arquivo; build e HMR ficam lentos; bugs de estado | **Crítica** |
| P2 | `server/index.mjs` monolítico (278 KB) com rotas, SQL, regras e SSE misturados | Mesmo problema no back-end; impossível de testar por módulo | **Crítica** |
| P3 | Coedição com rebase próprio por tipo de operação (cada novo tipo exige merge, conflito 409 e testes) | Custo cresce linearmente com as features; conflitos 409 expostos ao usuário; não há offline real | **Alta** |
| P4 | SQLite local + objetos em disco + SSE em um processo | Não escala horizontalmente; não está pronto para produção (o próprio README admite) | **Alta** |
| P5 | Modelo de documento em tipos TS sem schema validável nem migrações por versão | Formato frágil; impossível oferecer um "formato aberto" | **Alta** |
| P6 | Renderização duplicada (Konva no editor, canvas próprio no export, SVG próprio) | Divergências entre o editor e os exports (documentadas no próprio status) | **Média** |
| P7 | Export pesado no navegador (vídeo, PDF grande, GIF) | Trava dispositivos fracos; sem render headless/API | **Média** |
| P8 | Encoding corrompido (mojibake em `IMPLEMENTATION-PLAN.md` e em pelo menos 8 entradas de `IMPLEMENTATION-STATUS.json`) | Documentação ilegível; sinal de pipeline de escrita sem UTF-8 garantido | **Média** |
| P9 | Sem i18n estruturado (textos PT/EN misturados no código) | Bloqueia uma comunidade global | **Média** |
| P10 | Sem CI, licença, CONTRIBUTING ou governança | Bloqueia o open source | **Alta** |
| P11 | O repositório mistura produto e pesquisa (analysis/ com 6,2 GB, código proprietário capturado, URLs assinadas) | Risco legal e de vazamento; o push falha (arquivos > 100 MB) | **Crítica** |

### 3.4 Status real dos 131 casos

- 2 casos "validados" e 129 "implementação parcial".
- A maioria dos "parciais" **já funciona para o usuário**. Ficam parciais porque o critério exige paridade de pixel ou comportamento com o Canva. O exemplo é o Brand Review: MAE 24,753/255, "não atesta fidelidade".
- Ou seja, o placar subestima o produto. Com critérios próprios (seção 6 do plano v2), estima-se que **60–70% dos casos já passariam** depois de um teste de aceite reescrito.

---

## 4. Diagnóstico do plano v1

| Aspecto | Plano v1 | Problema |
| --- | --- | --- |
| Norte | "Equivalência com o Canva" | Leva a copiar em vez de superar; risco de trade dress; critério inalcançável (pixel) |
| Formato | 320 KB de log cronológico de tranches | Não serve como roteiro; não mostra o que falta |
| Arquitetura | "Registrar ADR... verificar versões" e nunca decidido | Gerou os monólitos P1/P2 e a coedição artesanal P3 |
| Fases | 8 fases sequenciais por área | Não há paralelismo planejado nem fronteiras de código para trabalho simultâneo |
| Aceite | Gates genéricos + 131 casos ligados a capturas | Sem orçamento de desempenho, sem SLO, sem critério de produto |
| Open source | Ausente | Sem licença, plugin SDK, formato aberto, self-host ou governança |
| Diferenciação | Ausente | Nenhum motivo para alguém trocar de ferramenta |

---

## 5. Onde o Fuse Studio pode ser melhor que o Canva

Estes são diferenciais **estruturais**, que um produto fechado e centralizado não oferece com facilidade:

1. **Formato aberto e documentado (`.fuse`):** JSON Schema versionado + assets num zip. Pode ser lido, versionado em Git e convertido sem lock-in.
2. **Local-first e offline de verdade:** CRDT com IndexedDB; edição offline completa e sincronização ao reconectar, sem diálogos de conflito.
3. **Self-host com um comando:** `docker compose up` com Postgres, MinIO, Redis e o app. Dados sob controle de empresas, escolas e governos (LGPD/GDPR).
4. **IA com sua própria chave ou modelo local:** OpenAI-compatible, Anthropic, Ollama/llama.cpp e Stable Diffusion local. Sem créditos artificiais; privacidade por padrão.
5. **Plugin SDK aberto:** apps rodam em iframe sandbox com permissões declaradas. Qualquer pessoa publica plugins num marketplace comunitário.
6. **Render headless + API + CLI:** `fuse render design.fuse --format pdf`, geração em lote por API, templates como código e integração em CI/CD de marketing.
7. **Export profissional real:** SVG/PDF vetoriais com fontes embutidas, PDF/X-1a/X-4 com sangria e marcas de corte para gráfica, CMYK, PDF/UA acessível e PPTX/DOCX/XLSX editáveis.
8. **Histórico como Git:** versões nomeadas, branches de design ("variante A/B"), diff visual e merge.
9. **Acessibilidade como requisito, não extra:** checker integrado (contraste, alt, ordem de leitura) bloqueando exports com problemas configuráveis.
10. **Sem paywall de recursos básicos:** remoção de fundo, kits de marca e redimensionamento mágico usando modelos abertos (ex.: segmentação on-device em WebGPU/ONNX).

---

## 6. Riscos e pontos de atenção

| Risco | Mitigação |
| --- | --- |
| **Propriedade intelectual**: código capturado, nomes internos, layout ou trade dress | Repositório limpo: só requisitos reescritos; identidade visual própria; proibir agentes de abrir as classes E/F; revisão de nomes (nada de "Canva", "Dream Lab", "Magic") |
| **Dados sensíveis** no corpus (URLs assinadas, sessões) | Mover `analysis/` para fora do repositório; nunca versionar; rotacionar ou invalidar sessões usadas na captura |
| **Fontes e assets licenciados** | Usar só fontes OFL (Google Fonts) e assets CC0/próprios; registrar a licença de cada asset no manifesto |
| **Escopo gigante** | Plano em ondas com MVP público na onda 3; módulos com dono e fronteira de código claros |
| **Migração do código atual** | Estratégia *strangler*: extrair pacotes puros primeiro e trocar o núcleo (CRDT) atrás de uma interface, preservando os testes |
| **Custo de IA/GPU** | BYO-key/local por padrão; a instância hospedada usa quotas configuráveis |

---

## 7. Conclusão

O corpus cumpriu o papel de **mapa de território**: diz *o que* um editor visual completo precisa fazer, em 14 domínios e 248 famílias de componentes. Ele **não** deve ditar *como* o produto parece nem como é construído. O código atual mostra que a equipe consegue entregar features rápido. O gargalo é a fundação.

O plano v2 ([02-PLANO-V2.md](02-PLANO-V2.md)) troca o norte de "equivalência" para "produto aberto superior". Ele também decide a arquitetura que faltava e organiza o trabalho em ondas paralelas executáveis por agentes ([03-AGENTES-OPUS.md](03-AGENTES-OPUS.md)).
