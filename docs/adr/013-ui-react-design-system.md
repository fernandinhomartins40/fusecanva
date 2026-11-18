# ADR-013 — UI com React 19 e design system próprio (tokens CSS, Radix, Lucide)

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-014, ADR-018, princípios 1 e 6 do plano v2

## Contexto

Os componentes atuais são ad hoc, cada painel tem o próprio CSS e o comportamento de acessibilidade é inconsistente. O produto precisa de identidade visual própria e de WCAG 2.2 AA como gate de merge.

## Decisão

- **React 19** em `apps/web` e nos pacotes `editor-*`.
- `packages/ui` é o design system próprio:
  - **tokens CSS** (custom properties) para cor, tipografia, espaço, raio, sombra e movimento, com tema claro e escuro e contraste AA verificado em teste;
  - **Radix primitives** como base de comportamento acessível (diálogo, menu, popover, tabs, tooltip etc.), estilizadas com os nossos tokens;
  - ícones **Lucide** (licença ISC), importados individualmente para tree-shaking.
- Storybook e axe rodam no CI para cada componente.
- Nenhum nome, cor, layout ou asset de terceiros (princípio 1).

## Consequências

- **Positivas:** acessibilidade testada nos primitives; identidade consistente; temas por tokens.
- **Negativas:** migrar os painéis atuais exige reescrever o CSS; o Radix impõe a sua estrutura de composição.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| Componentes ad hoc (estado atual) | Acessibilidade e visual inconsistentes |
| Biblioteca completa estilizada (MUI, Chakra etc.) | Identidade visual alheia; difícil de personalizar a fundo |
| React Aria | Excelente alternativa; Radix escolhido pela API mais simples. Pode ser reavaliado por componente |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote | Versão estável | Link oficial |
| --- | --- | --- |
| `react` | 19.3.1 | https://react.dev |
| `react-dom` | 19.3.1 | https://react.dev |
| `radix-ui` (pacote unificado) | 1.8.1 | https://www.radix-ui.com/primitives |
| `@radix-ui/react-dialog` (exemplo de pacote individual) | 1.3.1 | https://www.radix-ui.com/primitives/docs/components/dialog |
| `lucide-react` | 1.74.0 | https://lucide.dev |
