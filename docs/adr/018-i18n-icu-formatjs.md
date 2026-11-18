# ADR-018 — i18n com ICU MessageFormat (FormatJS), PT-BR e EN na v2

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-013, DoD item 6 do plano v2

## Contexto

As strings da interface hoje são literais no código, em português. Um projeto open source precisa de comunidade global, e a DoD exige "sem strings literais; PT-BR + EN".

## Decisão

- Mensagens no padrão **ICU MessageFormat** (plurais, gênero, seleção, números, datas), com a biblioteca **FormatJS** (`react-intl` no React, `@formatjs/intl` fora dele).
- `packages/i18n` guarda os catálogos `pt-BR` e `en`, com IDs estáveis e descrição para tradutores.
- `@formatjs/cli` extrai e compila as mensagens no build; o CI falha se houver chave faltando em algum idioma ou string literal visível (regra de lint).
- Locale detectado pelo navegador, com escolha explícita salva no perfil do usuário; formatação de números e datas pela API `Intl`.
- O servidor usa os mesmos catálogos para e-mails e notificações.

## Consequências

- **Positivas:** padrão aberto e compatível com plataformas de tradução; plurais corretos.
- **Negativas:** custo de extrair as strings atuais; o bundle cresce com os catálogos (carregados por locale, sob demanda).

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| Strings literais (estado atual) | Sem tradução possível |
| i18next | Viável; formato próprio de interpolação, com ICU só via plugin |
| Lingui | Viável; FormatJS escolhido pelo uso do padrão ICU direto e pela maturidade |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote | Versão estável | Link oficial |
| --- | --- | --- |
| `react-intl` | 12.1.8 | https://formatjs.github.io/docs/react-intl |
| `@formatjs/intl` | 6.1.6 | https://formatjs.github.io/docs/intl |
| `intl-messageformat` | 12.2.0 | https://formatjs.github.io/docs/intl-messageformat |
| `@formatjs/cli` | 6.20.0 | https://formatjs.github.io/docs/tooling/cli |
