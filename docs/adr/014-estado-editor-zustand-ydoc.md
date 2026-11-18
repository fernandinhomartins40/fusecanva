# ADR-014 — Estado do editor em store por documento (Zustand) derivado do Y.Doc

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-004, ADR-013

## Contexto

O `App.tsx` atual concentra cerca de 295 `useState` no componente raiz. Qualquer mudança re-renderiza grande parte da árvore, e o estado não pode ser testado fora do React.

## Decisão

- O **Y.Doc** (ADR-004) é a fonte de verdade do conteúdo do documento.
- Cada documento aberto tem uma **store Zustand** em `packages/editor-core`, que:
  - projeta o Y.Doc num snapshot imutável, atualizado por eventos `observeDeep` em lotes;
  - guarda o estado efêmero local (seleção, ferramenta ativa, viewport, hover), que não vai para o Y.Doc;
  - expõe **comandos** (funções puras + transação Yjs) como a única forma de mudar o documento.
- O React só observa **seletores** finos (`useStore(selector)`), com comparação rasa.
- O estado global da aplicação (sessão, preferências, rotas) fica em stores Zustand por domínio em `apps/web/features/*`.

## Consequências

- **Positivas:** re-render mínimo; lógica do editor testável sem React; comandos reutilizáveis por atalhos, menus, IA e plugins.
- **Negativas:** duas representações (Y.Doc e snapshot) exigem cuidado para não divergirem; os testes do binding ficam em `packages/collab`.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| Estado no componente raiz (estado atual) | Re-render global; impossível testar isolado |
| Redux Toolkit | Mais cerimônia; o Y.Doc já cumpre o papel de log de ações |
| Jotai / signals | Viáveis; Zustand escolhido pela simplicidade e por funcionar fora do React |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote | Versão estável | Link oficial |
| --- | --- | --- |
| `zustand` | 5.1.0 | https://zustand.docs.pmnd.rs |
| `yjs` | 13.6.33 | https://docs.yjs.dev |
