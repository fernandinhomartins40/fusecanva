# @fuse/i18n

Catálogos de mensagens em ICU MessageFormat (FormatJS), pt-BR (origem) e en. ADR-018.

```ts
import { t, setLocale, resolveLocale, createI18n } from '@fuse/i18n'

setLocale(resolveLocale(navigator.languages)) // 'pt-BR' | 'en'
t('common.save')                       // "Salvar"
t('project.count', { count: 3 })       // "3 projetos"
createI18n('en').intl.formatNumber(1234.5) // "1,234.5"
```

- Chaves tipadas (`MessageKey`), derivadas de `src/catalogs/pt-BR.ts`. O catálogo `en` é `Record<MessageKey, string>`, então chave faltante já quebra o `typecheck`.
- `test/catalogs.test.ts` verifica, para cada idioma: chaves faltantes, chaves sobrando, mensagens vazias, sintaxe ICU válida e os mesmos argumentos (nome e tipo, incluindo plural/select) do pt-BR.
- Chave inexistente em tempo de execução devolve a própria chave; mensagem ausente no idioma cai no pt-BR.

## Adicionar uma mensagem

1. Inclua a chave em `src/catalogs/pt-BR.ts` (namespace por domínio: `common.`, `ui.`, `editor.`, ...).
2. Traduza em `src/catalogs/en.ts`.
3. `pnpm --filter @fuse/i18n test`.
