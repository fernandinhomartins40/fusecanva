# @fuse/ui

Design system do Fuse Studio: tokens, temas claro/escuro e 25 componentes base acessíveis (React 19 + Radix primitives + ícones Lucide). ADR-013.

## Uso

```tsx
import '@fuse/ui/styles.css' // tokens + componentes, uma vez na raiz
import { ThemeProvider, Button, Field, Input } from '@fuse/ui'
import { t } from '@fuse/i18n'

<ThemeProvider theme="system">
  <Field label={t('project.untitled')}><Input /></Field>
  <Button variant="primary">{t('common.save')}</Button>
</ThemeProvider>
```

- `ThemeProvider theme="light" | "dark" | "system"` grava `data-fuse-theme` no `<html>` (para que portais herdem o tema). Sem atributo, o CSS segue `prefers-color-scheme`.
- Os componentes não têm textos embutidos: rótulos acessíveis (`label`, `closeLabel`, `loadingLabel`, `thumbLabels`, `regionLabel`) são obrigatórios e vêm do `@fuse/i18n`.
- Ícones: use `lucide-react` diretamente, sempre com `aria-hidden="true"` quando decorativos.

## Tokens

Fonte única em TypeScript (`src/tokens`); o CSS (`dist/tokens.css`) é gerado no build por `buildTokensCss()`.

| Grupo | Custom properties | TS |
| --- | --- | --- |
| Cor (35 papéis × 2 temas) | `--fuse-color-*` | `lightColors`, `darkColors`, `themes` |
| Tipografia (fontes OFL: Inter, Fraunces, JetBrains Mono) | `--fuse-font-*`, `--fuse-font-size-*`, `--fuse-font-weight-*`, `--fuse-line-height-*` | `fontFamilies`, `fontSizes`, ... |
| Espaço | `--fuse-space-*` | `space` |
| Raio | `--fuse-radius-*` | `radii` |
| Sombra (por tema) | `--fuse-shadow-*` | `shadows` |
| Movimento (zerado em `prefers-reduced-motion`) | `--fuse-duration-*`, `--fuse-ease-*` | `durations`, `easings` |
| Camadas | `--fuse-z-*` | `zIndices` |

Identidade própria: acento "brasa" (laranja-avermelhado quente) sobre neutros "grafite" levemente quentes, foco em azul. Nenhum valor vem da paleta medida no corpus de análise.

### Contraste WCAG AA

`contrastPairs` lista cada par primeiro plano/fundo que a UI usa, com o mínimo exigido (texto 4.5:1; componentes de UI e foco 3:1). `test/contrast.test.ts` calcula a razão (luminância relativa WCAG 2.2) para todos os pares nos dois temas e falha se algum ficar abaixo. Ao mudar uma cor, rode `pnpm --filter @fuse/ui test`.

## Componentes

Button, IconButton, Input, Textarea, Select, Checkbox, Switch, RadioGroup/Radio, Slider, Tabs, Dialog, Popover, Tooltip, Menu, Toast (`ToastProvider` + `useToast`), Card, Badge, Avatar, Spinner, Skeleton, EmptyState, Toolbar, Panel, Divider, VisuallyHidden — mais `Field` (rótulo/descrição/erro ligados por ARIA) e `ThemeProvider`.

## Scripts

- `pnpm --filter @fuse/ui build` — `tsc -b` + gera `dist/tokens.css`, `dist/components.css`, `dist/styles.css`.
- `pnpm --filter @fuse/ui test` — Vitest: contraste, tokens e componentes (jsdom + Testing Library + axe-core; a regra `color-contrast` do axe fica desligada porque o jsdom não calcula cor — o contraste é coberto pelo teste próprio).
- `pnpm --filter @fuse/ui typecheck` — fontes e testes.

## Storybook

Não instalado nesta entrega (opcional na ficha A0-09). O teste "galeria completa" em `test/components.test.tsx` renderiza todos os componentes e roda o axe. Para adicionar Storybook depois: `@storybook/react-vite` neste pacote, histórias em `stories/` e `axe` via `@storybook/addon-a11y`.
