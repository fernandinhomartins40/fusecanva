# D01 — Shell, projetos e organização

Navegação global, organização de arquivos em pastas, busca e filtros, lixeira, galeria de modelos e preferências da conta.

Histórias: 18. Rastreabilidade para os casos de origem em [rastreabilidade.csv](rastreabilidade.csv).

## US-001 — Rotas abrem diretamente

Como pessoa usuária, quero abrir qualquer tela do app colando o endereço dela, para retomar o trabalho a partir de favoritos, links e histórico do navegador.

- Prioridade: **Must**
- Onda alvo: **1**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Rotas abrem diretamente

  Cenário: Abrir rota profunda sem navegação prévia
    Dado que estou autenticada e tenho o endereço de um documento
    Quando abro esse endereço numa aba nova
    Então a tela do documento carrega sem erros no console
    E o título, o tipo e o estado de salvamento do documento ficam visíveis

  Cenário: Rota inexistente
    Dado um endereço que não corresponde a nenhum recurso
    Quando eu o abro
    Então vejo uma página de "não encontrado" com caminho de volta para o início
```

## US-002 — Estados de interação consistentes nos controles

Como pessoa usuária, quero que todo botão mostre estados claros de repouso, foco, passagem do ponteiro, pressionado e desabilitado, para entender o que é clicável sem adivinhar.

- Prioridade: **Must**
- Onda alvo: **0**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Estados de interação consistentes nos controles

  Cenário: Passagem do ponteiro é reversível
    Dado um botão em repouso
    Quando posiciono o ponteiro sobre ele sem clicar
    Então o botão muda para o estado de destaque definido pelos tokens do design system
    E quando afasto o ponteiro ele volta exatamente ao estado de repouso
    E nenhum dado do documento é alterado
```

## US-003 — Tema claro e escuro persistente

Como pessoa usuária, quero escolher entre tema claro, escuro ou do sistema, para trabalhar com conforto em qualquer ambiente.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Tema claro e escuro persistente

  Cenário: Preferência sobrevive ao recarregamento
    Dado que escolhi o tema escuro nas preferências da conta
    Quando recarrego a página
    Então o app abre no tema escuro e a opção escolhida aparece marcada
    E quando troco para claro e recarrego, o app abre no tema claro
```

## US-004 — Navegação inferior no celular

Como pessoa usuária no celular, quero uma barra de navegação inferior com início e meus projetos, para alternar entre as áreas principais com o polegar.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Navegação inferior no celular

  Cenário: Ida e volta entre início e projetos
    Dado que estou numa tela de 360 px de largura
    Quando toco no destino de projetos da barra inferior
    Então a lista de todos os meus projetos aparece e o destino fica marcado como atual
    E quando toco no destino de início volto para a tela inicial
    E cada alvo de toque tem pelo menos 44 × 44 px
```

## US-005 — Filtrar projetos por tipo e data com URL compartilhável

Como criadora, quero filtrar meus projetos por tipo de documento e por data de edição, para achar rapidamente o que mexi recentemente.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Filtrar projetos por tipo e data com URL compartilhável

  Cenário: Filtro refletido no endereço
    Dado que filtrei por planilhas editadas hoje
    Quando copio o endereço e o abro em outra aba
    Então os mesmos dois filtros aparecem aplicados
    E a lista mostra apenas os itens que atendem aos dois

  Cenário: Combinação sem resultados
    Dado uma combinação de filtros que não encontra nada
    Então vejo um estado vazio explicativo com ação para limpar filtros
    Quando limpo os filtros
    Então a lista completa volta
```

## US-006 — Limpar busca sem perder o escopo

Como criadora, quero limpar o texto da busca mantendo o escopo e os filtros que escolhi, para refinar a busca em etapas.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Limpar busca sem perder o escopo

  Cenário: Limpar só o texto
    Dado que estou vendo apenas designs e busquei por um termo
    Quando limpo o campo de busca
    Então o escopo de designs continua aplicado
    E quando escolho limpar todos os filtros, o escopo também é removido
```

## US-007 — Busca full-text nos projetos

Como criadora, quero buscar pelo título e pelo texto contido nos meus arquivos, para encontrar um documento mesmo sem lembrar o nome.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Busca full-text nos projetos

  Cenário: Busca por conteúdo
    Dado um documento cujo corpo contém a palavra "orçamento"
    Quando busco "orcamento" sem acento
    Então o documento aparece nos resultados com o trecho destacado
```

## US-008 — Criar e renomear pastas

Como criadora, quero criar pastas e renomeá-las direto na lista, para organizar meus arquivos do meu jeito.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Criar e renomear pastas

  Cenário: Renomear com confirmação e cancelamento
    Dado uma pasta recém-criada com nome padrão
    Quando edito o nome e confirmo com Enter
    Então o novo nome persiste após recarregar
    Mas quando edito e pressiono Escape
    Então o nome anterior é mantido
```

## US-009 — Detalhes da pasta

Como criadora, quero ver os detalhes de uma pasta (dono, criação, itens, acesso), para saber o contexto de uma pasta sem abri-la.

- Prioridade: **Could**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Detalhes da pasta

  Cenário: Painel de detalhes recolhível
    Dado uma pasta selecionada
    Quando abro os detalhes
    Então vejo dono, data de criação, quantidade de itens e nível de acesso
    E posso recolher e expandir a seção sem perder a seleção
```

## US-010 — Favoritar pastas

Como criadora, quero marcar pastas como favoritas, para ter atalhos para o que uso sempre.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Favoritar pastas

  Cenário: Favorito persistente e reversível
    Dado uma pasta não favoritada
    Quando a marco como favorita
    Então ela aparece na seção de favoritos da navegação e continua lá após recarregar
    E quando desmarco, ela sai da seção de favoritos
```

## US-011 — Visualização em grade ou lista

Como criadora, quero alternar a lista de projetos entre grade e lista com colunas, para comparar metadados de muitos itens.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Visualização em grade ou lista

  Cenário: Modo lembrado
    Dado que mudei para o modo lista
    Quando recarrego a página
    Então o modo lista continua ativo com colunas de nome, tipo, dono e data de edição

  Cenário: Filtro sem itens
    Dado uma pasta sem imagens
    Quando filtro por imagens
    Então vejo um estado vazio, e ao limpar o filtro os itens voltam
```

## US-012 — Mover arquivos para uma pasta

Como criadora, quero selecionar arquivos num seletor e movê-los para uma pasta, para reorganizar sem arrastar item por item.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Mover arquivos para uma pasta

  Cenário: Mover habilita só com seleção
    Dado o seletor de arquivos aberto para uma pasta
    Então a ação de mover começa desabilitada
    Quando seleciono um arquivo
    Então a ação fica habilitada e, ao confirmar, o arquivo aparece na pasta destino após recarregar

  Cenário: Cancelar não altera nada
    Dado que filtrei o seletor por um termo
    Quando cancelo sem confirmar
    Então o seletor fecha e o conteúdo da pasta continua igual
```

## US-013 — Duplicar e excluir pastas

Como criadora, quero duplicar uma pasta e excluir apenas a cópia, para reaproveitar estruturas com segurança.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Duplicar e excluir pastas

  Cenário: Cópia independente
    Dado uma pasta
    Quando a duplico
    Então surge uma nova pasta com identificador próprio e nome indicando cópia
    E quando excluo a cópia, a original continua intacta e o endereço da cópia passa a indicar item na lixeira
```

## US-014 — Escopo de acesso da pasta

Como criadora, quero ver e escolher quem pode acessar uma pasta (só eu, minha equipe, link), para controlar a exposição de vários arquivos de uma vez.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Escopo de acesso da pasta

  Cenário: Inspecionar sem alterar
    Dado uma pasta privada
    Quando abro as opções de acesso e fecho sem escolher
    Então o escopo continua privado e nenhum convite é enviado
```

## US-015 — Lixeira com restauração

Como criadora, quero mover arquivos para a lixeira e restaurá-los, para desfazer exclusões acidentais.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Lixeira com restauração

  Cenário: Confirmação e cancelamento
    Dado um design com conteúdo aberto
    Quando peço para movê-lo à lixeira e cancelo a confirmação
    Então continuo no editor com o mesmo design

  Cenário: Restaurar preserva conteúdo
    Dado um design na lixeira
    Quando escolho restaurar
    Então ele sai da lixeira, volta à lista de projetos e reabre com o mesmo conteúdo
    E itens na lixeira são removidos definitivamente após o prazo configurado pela instância
```

## US-016 — Buscar modelos com filtro de idioma

Como criadora, quero buscar na galeria de modelos e filtrar por idioma, para começar de um ponto de partida no meu idioma.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Buscar modelos com filtro de idioma

  Cenário: Busca e filtro independentes
    Dado que busquei um termo com o filtro de português ativo
    Quando limpo só a busca
    Então o filtro de idioma continua aplicado e refletido no endereço
    E quando limpo só o filtro, o termo de busca é mantido
    E recarregar a página preserva ambos
```

## US-017 — Pré-visualizar modelos

Como criadora, quero pré-visualizar um modelo com todas as páginas antes de usá-lo, para decidir sem criar arquivos à toa.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Pré-visualizar modelos

  Cenário: Navegar páginas e fechar camada por camada
    Dado a pré-visualização de um modelo com várias páginas
    Quando seleciono a segunda página
    Então ela é exibida em destaque com as dimensões do modelo
    Quando abro o menu de ações e pressiono Escape
    Então só o menu fecha e a pré-visualização continua aberta
    E um segundo Escape fecha a pré-visualização mantendo a busca anterior
```

## US-018 — Modelos comunitários com licença explícita

Como criadora, quero saber a licença e o autor de cada modelo, para usar modelos sem risco jurídico.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Modelos comunitários com licença explícita

  Cenário: Licença visível
    Dado um modelo publicado na galeria
    Então a pré-visualização mostra autor e licença (por exemplo CC0 ou CC-BY)
```
