# Como contribuir com o Fuse Studio

Obrigado pelo interesse! Este guia leva você do clone ao primeiro pull request em cerca de 15 minutos e explica as regras que todo PR precisa seguir.

Ao participar, você concorda com o [Código de Conduta](CODE_OF_CONDUCT.md). Vulnerabilidades seguem o [SECURITY.md](SECURITY.md), nunca uma issue pública.

> O projeto está em **pré-alpha**. APIs, pacotes e o formato `.fuse` ainda mudam. Antes de começar algo grande, abra uma issue para alinhar.

---

## Primeiro PR em 15 minutos

### 1. Prepare o ambiente (cerca de 5 min)

Você precisa de **Node.js 22.12+**, **Git** e **pnpm 10** (o Corepack instala a versão fixada em `package.json`).

```sh
git clone https://github.com/<seu-usuario>/fuse-studio.git
cd fuse-studio
corepack enable
pnpm install
```

No Windows sem administrador, se `corepack enable` falhar com `EPERM`, use `corepack enable --install-directory "%APPDATA%\npm" pnpm`.

### 2. Escolha uma tarefa (cerca de 2 min)

- Issues com o rótulo **`good first issue`** são pequenas e têm um pacote dono claro.
- Correções de documentação, de mensagens de erro e de testes também são bem-vindas.
- Se a mudança tocar o formato `.fuse`, o SDK ou a arquitetura, leia antes o [ADR correspondente](docs/adr/README.md).

### 3. Crie a branch e faça a mudança (cerca de 5 min)

```sh
git switch -c fix/editor-core-zoom-limite
```

Mexa só no pacote ou app da tarefa (veja [Escopo](#escopo-de-cada-pr)). Rode o app se precisar ver a mudança:

```sh
cp .env.example .env
pnpm dev          # http://localhost:5173
```

### 4. Verifique (cerca de 2 min)

Rode só o que você tocou. O filtro com `...` inclui os dependentes do pacote:

```sh
pnpm turbo run lint typecheck test --filter=@fuse/<pacote>...
```

Antes de pedir revisão, rode a suíte completa, que é o que o CI executa:

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

### 5. Commit e PR (cerca de 1 min)

```sh
git commit -s -m "fix(editor-core): limitar zoom mínimo a 10%"
git push -u origin fix/editor-core-zoom-limite
```

Abra o PR. O modelo de descrição traz o checklist da Definição de Pronto: preencha, cole a saída dos comandos e referencie a issue ou user story (`US-123`, `#45`).

Pronto! A revisão costuma começar em poucos dias.

---

## Mensagens de commit: Conventional Commits

Usamos [Conventional Commits 1.0.0](https://www.conventionalcommits.org/pt-br/v1.0.0/). As mensagens são **em inglês**; issues, PRs e documentação podem ser em português.

```text
<tipo>(<escopo>): <descrição no imperativo, minúscula, sem ponto final>

[corpo opcional: o porquê da mudança]

[rodapé opcional: BREAKING CHANGE: ..., Refs: US-123, Closes #45]
Signed-off-by: Seu Nome <voce@exemplo.org>
```

| Tipo | Quando usar |
| --- | --- |
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `docs` | Só documentação |
| `refactor` | Mudança de código sem mudar comportamento |
| `perf` | Melhoria de desempenho |
| `test` | Testes novos ou corrigidos |
| `build` | Build, dependências, pnpm, Turborepo |
| `ci` | Workflows e scripts de CI |
| `chore` | Manutenção sem efeito no produto |
| `revert` | Reverte um commit anterior |

- **Escopo** = nome do pacote ou app sem o prefixo `@fuse/`: `format`, `renderer`, `editor-core`, `web`, `cli`, `infra`, `adr`.
- **Mudança incompatível**: use `!` depois do tipo (`feat(format)!: ...`) e explique no rodapé `BREAKING CHANGE:`. Toda mudança incompatível no `.fuse` precisa de migração e de incremento de `schemaVersion`.
- Prefira commits pequenos, cada um com uma ideia só.

Exemplos:

```text
feat(renderer): draw dashed strokes on paths
fix(collab): keep undo stack per user after reconnect
docs(adr): record decision on font fallback
feat(format)!: rename node.fills to node.paints
```

### Assinatura (DCO)

Todo commit precisa da linha `Signed-off-by` (use `git commit -s`). Com ela, você declara que tem o direito de enviar o código, nos termos do [Developer Certificate of Origin 1.1](https://developercertificate.org). O nome e o e-mail da linha precisam ser os mesmos do autor do commit.

> A escolha entre DCO e CLA ainda depende do mantenedor (ADR-020). Até lá, o DCO é obrigatório.

---

## Escopo de cada PR

O repositório é um monorepo com fronteiras firmes ([ADR-001](docs/adr/001-monorepo-pnpm-turborepo.md)):

1. **Um PR, um objetivo, de preferência um pacote.** Se precisar tocar vários pacotes, explique por quê na descrição.
2. **Pacotes conversam só pela API pública** (`packages/<x>/src/index.ts`). Imports profundos (`@fuse/x/src/...`) e imports relativos entre pacotes são barrados pelo `pnpm lint`.
3. **Mudar o contrato público de um pacote** (tipos exportados, formato `.fuse`, API REST, SDK de plugins) exige uma issue antes, e às vezes um ADR.
4. **Pacotes MIT** (`packages/format`, `packages/sdk`, `apps/cli`) **não podem depender** de pacotes AGPL. Veja a seção Licenças do [README](README.md#licenças).
5. **Sem formatação em massa.** Não rode formatadores no repositório inteiro e não misture reformatação com mudança de lógica.
6. **Arquivos em UTF-8 sem BOM**, finais de linha LF, nenhum arquivo acima de 5 MB. O CI verifica.
7. **Nada de segredos ou dados pessoais**: `.env`, tokens, cookies, dumps de sessão, e-mails reais.

### Definição de Pronto

Uma feature só está pronta quando atende ao §6 do [plano v2](docs/v2/02-PLANO-V2.md#6-definição-de-pronto-dod--por-feature). Em resumo:

- funciona de ponta a ponta, inclusive com 2 pessoas editando ao mesmo tempo e no ciclo offline → online;
- desfazer/refazer correto para cada pessoa;
- acessível (teclado, foco visível, rótulos, axe sem erros) e responsivo (360, 768 e 1280 px);
- sem textos fixos no código: tudo passa pelo i18n (PT-BR e EN);
- testes unitários, um E2E do fluxo principal e golden image quando houver render;
- documentação atualizada.

---

## Propriedade intelectual: só trabalho original

O Fuse Studio é um **produto próprio**, não uma cópia de outro produto. Esta regra não tem exceção:

- **Proibido** enviar código, textos, nomes de recursos, ícones, ilustrações, fontes, cores, layouts, templates ou qualquer asset copiado ou derivado de produtos de terceiros, inclusive código capturado de sites e aplicativos (bundles, source maps, scripts minificados).
- **Proibido** mencionar marcas de produtos concorrentes em código, interface, assets ou nomes de recursos.
- **Dependências e assets de terceiros** só entram se tiverem licença compatível (MIT, BSD, Apache-2.0, ISC, OFL para fontes, CC0 ou CC-BY para mídia) e se a origem e a licença ficarem registradas no PR. Em pacotes MIT, a dependência também precisa ser permissiva.
- **Gerado por IA**: é permitido, mas você é responsável pelo resultado e precisa garantir que ele não reproduz material protegido.
- O material de pesquisa local (`analysis/`, `visual-references/`) **não** pode ser copiado para o repositório. Ele serve só para entender *o que* o usuário precisa, nunca *como* outro produto faz. Para requisitos, use as user stories em [docs/backlog/](docs/backlog/README.md).

PRs que violem esta seção são fechados, e o histórico afetado é removido.

---

## Outras formas de contribuir

- **Relatar bugs**: use o modelo de issue, com passos para reproduzir, o resultado esperado e o obtido, e a versão.
- **Propor funcionalidades**: descreva o problema do usuário antes da solução.
- **Propor decisões de arquitetura**: abra um PR com um novo ADR em `docs/adr/` (veja o [índice](docs/adr/README.md)).
- **Traduções**: catálogos em `packages/i18n`.

## Licença das contribuições

Ao contribuir, você licencia o seu trabalho sob a licença do pacote que recebe a mudança: AGPL-3.0-only na maior parte do repositório e MIT em `packages/format`, `packages/sdk` e `apps/cli`. Veja o [README](README.md#licenças) e o [ADR-020](docs/adr/020-licenca-agpl-mit.md).
