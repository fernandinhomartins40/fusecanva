# ADR-020 — Licença: AGPL-3.0 para app e servidor, MIT para `@fuse/sdk`, `@fuse/format` e CLI

- **Status:** Proposto — decisão do mantenedor
- **Data:** 2026-11-17
- **Relacionados:** ADR-003, ADR-015; agente A0-10 (kit open source) depende deste ADR

## Contexto

O Fuse Studio será open source e auto-hospedável. Duas forças se opõem:

1. Proteger o projeto contra um SaaS fechado derivado, que use o código sem devolver melhorias.
2. Facilitar o ecossistema: plugins, leitores do formato `.fuse` e integrações de terceiros, inclusive comerciais, não devem ser obrigados a adotar uma licença copyleft.

## Decisão proposta

- **AGPL-3.0-only** (ou `-or-later`, a decidir) para `apps/web`, `apps/server`, `apps/worker` e para os pacotes internos do editor.
- **MIT** para `@fuse/sdk` (`packages/sdk`), `@fuse/format` (`packages/format`) e o CLI (`apps/cli`), para que qualquer pessoa possa ler e gravar `.fuse` e escrever plugins sob qualquer licença.
- Cada pacote declara `license` no `package.json` e tem identificador SPDX nos cabeçalhos dos arquivos.
- Contribuições sob **DCO** (Developer Certificate of Origin, `Signed-off-by`) em vez de CLA. Isso fica a confirmar pelo mantenedor, porque um CLA seria necessário para relicenciar no futuro.
- O CI verifica a compatibilidade de licença das dependências (pacotes MIT não podem depender de pacotes AGPL).

## Consequências

- **Positivas:** quem oferecer o app como serviço precisa publicar as modificações (AGPL §13); o formato e o SDK ficam livres para adoção ampla.
- **Negativas:** algumas empresas evitam AGPL, o que reduz contribuições corporativas; a fronteira AGPL/MIT precisa ser mantida no grafo de dependências.
- **Pendências para o mantenedor:** (a) aprovar o par AGPL/MIT; (b) escolher `-only` ou `-or-later`; (c) DCO ou CLA; (d) política de marca para o nome "Fuse Studio" (marca não coberta pela licença de código).

## Alternativas consideradas

| Alternativa | Por que foi rejeitada (proposta) |
| --- | --- |
| MIT em tudo | Permite fork fechado como SaaS |
| Apache-2.0 em tudo | Mesmo problema do MIT, com concessão de patente explícita |
| GPL-3.0 no app | Não cobre uso via rede (SaaS) |
| Licenças "source-available" (BSL, SSPL) | Não são aprovadas pela OSI; contrariam o princípio "aberto por padrão" |
| MPL-2.0 no SDK | Viável; MIT é mais simples para autores de plugins |

## Referências

| Licença | Link oficial |
| --- | --- |
| AGPL-3.0 | https://www.gnu.org/licenses/agpl-3.0.html |
| MIT | https://opensource.org/license/mit |
| DCO | https://developercertificate.org |
| Identificadores SPDX | https://spdx.org/licenses/ |
