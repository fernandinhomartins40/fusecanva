# Iconografia da interface

Use `lucide-react` para ícones de navegação, ações, ferramentas, estados e controles em toda a aplicação. O pacote já instalado (`lucide-react`) é a fonte única para ícones de interface; não introduza glifos Unicode, emojis, SVGs desenhados à mão, fontes de ícones ou uma segunda biblioteca para essas funções.

## Convenções

- Importe do `lucide-react` o ícone semântico mais próximo do uso.
- Mantenha tamanho, espessura do traço e alinhamento consistentes com o controle ao redor; controles compactos usam normalmente 14–18 px e ferramentas 18–24 px.
- Ícones decorativos devem usar `aria-hidden="true"`. Botões apenas com ícone precisam de `aria-label` e, quando útil, `title`.
- Preserve cor e estado por CSS/herança, sem versões duplicadas do mesmo ícone.

## SVGs que não são ícones de interface

SVGs usados como conteúdo editável ou renderização do produto continuam apropriados: formas vetoriais dos designs, traços livres, conectores, máscaras de imagem e ilustrações de assets. Não os substitua por ícones Lucide, pois representam o conteúdo criado pelo usuário ou uma prévia visual, não affordances de interface.

## Auditoria visual (2026-10-23)

A varredura das telas Home, editor, Docs, planilhas, vídeo, quadro branco e Sites encontrou os controles principais usando componentes de `lucide-react`. A Home ainda tinha um glifo Unicode de seleção (marca de verificação) no menu de tema; ele foi substituído por `Check`. Os SVGs restantes no editor são conteúdo vetorial, máscaras ou prévias do design, e não ícones de controle. `tests/iconography-static.test.mjs` cobre esses pontos de entrada e detecta marcas de verificação ou pictogramas Unicode embutidos em controles.

## Revisão

Ao adicionar um novo controle, confira os usos existentes em `App.tsx` e siga a convenção Lucide. Ao revisar aparentes ícones antigos, identifique primeiro se são controles ou conteúdo de design; só os controles entram nesta regra.

## Docs e planilhas (2026-10-26)

A revisao confirmou que a rail e a barra de Docs usam icones Lucide, assim como os controles de adicionar linha/coluna/aba e os comandos de navegacao de linha. O `fx` da barra de formula e uma abreviacao textual funcional, nao um pictograma. As amostras de borda pontilhada/tracejada sao previews CSS do estilo selecionado e devem continuar representando a linha, nao ser trocadas por icones genericos. O teste `iconography-static.test.mjs` cobre especificamente essas superficies e preserva esses dois casos intencionais.


## Revisao de video, quadro branco e Sites (2026-10-27)

A auditoria dos controles de timeline/transporte de video, dock e zoom do quadro branco, e previa/publicacao de Sites nao encontrou glifos antigos ou pictogramas misturados: as ferramentas usam lucide-react; formas vetoriais, forma de onda de audio e conteudo do usuario continuam como ilustracoes/conteudo. A revisao corrigiu dois simbolos Lucide decorativos sem aria-hidden (Enquadrar no quadro branco e Fechar previa de Sites). O teste iconography-static valida agora cada icone Lucide nas toolbars Video, Whiteboard e Sites, confere aria-hidden e rejeita misturas com glifos/fontes/imagens inline. A waveform com role=img permanece validada como conteudo rotulado.
