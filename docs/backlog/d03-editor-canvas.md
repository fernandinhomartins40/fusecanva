# D03 — Editor de canvas

Superfície de edição, ferramentas, seleção, transformações, zoom, camadas, acessibilidade do editor e verificador de acessibilidade.

Histórias: 13. Rastreabilidade para os casos de origem em [rastreabilidade.csv](rastreabilidade.csv).

## US-027 — Painel de ferramentas

Como criadora, quero abrir e fechar um painel com as ferramentas de criação (selecionar, desenho, formas, linhas, notas, texto, tabelas), para acessar tudo o que posso inserir num só lugar.

- Prioridade: **Must**
- Onda alvo: **1**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Painel de ferramentas

  Cenário: Abrir e fechar sem efeitos colaterais
    Dado o editor com o painel fechado
    Quando abro o painel de ferramentas
    Então ele aparece como painel de abas acessível, com a ferramenta de seleção ativa
    Quando fecho o painel
    Então o foco volta ao botão que o abriu
    E o documento não muda
```

## US-028 — Ferramenta de desenho livre

Como criadora, quero desenhar à mão livre com lápis, caneta e marcador e apagar trechos com borracha, para fazer anotações e esboços.

- Prioridade: **Must**
- Onda alvo: **1**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Ferramenta de desenho livre

  Cenário: Configurar e desenhar
    Dado a ferramenta de desenho ativa
    Quando escolho caneta, cor e espessura e desenho na página
    Então um traço editável é criado com esses atributos
    E a configuração escolhida persiste após recarregar

  Cenário: Borracha parcial
    Dado um traço existente
    Quando passo a borracha sobre parte dele
    Então só o trecho cruzado é removido e os fragmentos mantêm estilo e ordem
    E a ação pode ser desfeita
```

## US-029 — Zoom com predefinições e ajuste à tela

Como criadora, quero escolher níveis de zoom predefinidos e voltar para "ajustar à tela", para alternar entre detalhe e visão geral.

- Prioridade: **Must**
- Onda alvo: **1**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Zoom com predefinições e ajuste à tela

  Cenário: Zoom 100% e ajuste
    Dado o menu de zoom aberto
    Quando escolho 100%
    Então a página é exibida em tamanho real e o menu marca 100% ao reabrir
    Quando escolho ajustar à tela
    Então o zoom volta ao valor que encaixa a página inteira

  Cenário: Gestos
    Dado um dispositivo com toque
    Quando faço pinça na área de trabalho
    Então o zoom muda centrado no ponto entre os dedos
```

## US-030 — Arrastar objetos com precisão

Como criadora, quero arrastar objetos com feedback em tempo real e encaixe em guias, para posicionar elementos sem esforço.

- Prioridade: **Must**
- Onda alvo: **1**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Arrastar objetos com precisão

  Cenário: Ciclo completo do ponteiro
    Dado um objeto selecionado
    Quando o arrasto por 40 px para a direita
    Então ele acompanha o ponteiro durante o movimento
    E ao soltar, a posição final é gravada como uma única ação desfazível
    E outros objetos não mudam
```

## US-031 — Seleção múltipla, grupos e camadas

Como criadora, quero selecionar vários objetos, agrupá-los e reordenar camadas, para compor layouts complexos.

- Prioridade: **Must**
- Onda alvo: **1**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Seleção múltipla, grupos e camadas

  Cenário: Agrupar e desagrupar
    Dado três objetos selecionados
    Quando agrupo
    Então eles se movem juntos e aparecem como um grupo no painel de camadas
    E desagrupar devolve os três objetos nas mesmas posições
```

## US-032 — Guias, réguas e encaixe

Como criadora, quero réguas, guias arrastáveis e encaixe inteligente entre objetos, para alinhar com precisão.

- Prioridade: **Should**
- Onda alvo: **1**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Guias, réguas e encaixe

  Cenário: Encaixe no centro
    Dado um objeto sendo arrastado
    Quando seu centro se aproxima do centro da página
    Então uma guia aparece e o objeto encaixa
```

## US-033 — Editor navegável por teclado e leitor de tela

Como pessoa usuária de leitor de tela, quero regiões nomeadas, abas laterais rotuladas e foco previsível no editor, para usar o editor sem mouse.

- Prioridade: **Must**
- Onda alvo: **1**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Editor navegável por teclado e leitor de tela

  Cenário: Marcos e foco inicial
    Dado o editor recém-aberto
    Então existem marcos para cabeçalho, barra lateral, área de trabalho e propriedades
    E todos os controles focáveis têm nome acessível
    E a verificação automatizada de acessibilidade não aponta violações
```

## US-034 — Lista acessível de objetos do canvas

Como pessoa usuária de leitor de tela, quero percorrer os objetos da página como uma lista, para selecionar e editar elementos sem ver o canvas.

- Prioridade: **Should**
- Onda alvo: **1**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Lista acessível de objetos do canvas

  Cenário: Selecionar pela lista
    Dado a lista acessível de objetos
    Quando escolho um item
    Então o objeto correspondente é selecionado no canvas e seu nome é anunciado
```

## US-035 — Desempenho do editor dentro do orçamento

Como pessoa usuária, quero que o editor abra e responda rapidamente, para não perder o fluxo de trabalho.

- Prioridade: **Must**
- Onda alvo: **6**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Desempenho do editor dentro do orçamento

  Cenário: Medição reprodutível
    Dado um documento de referência com 200 objetos
    Quando meço cinco carregamentos com cache frio e cinco com cache quente
    Então as métricas de carregamento e de primeira pintura ficam dentro dos orçamentos do plano v2
    E o relatório registra ambiente, cache e execuções descartadas
```

## US-036 — Cronômetro de sessão

Como facilitadora, quero um cronômetro no editor que posso iniciar, ajustar e ocultar, para controlar o tempo de atividades e apresentações.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Cronômetro de sessão

  Cenário: Ajustar e recarregar
    Dado um cronômetro de 5 minutos
    Quando adiciono 1 minuto
    Então ele mostra 6 minutos
    E após recarregar o editor o cronômetro volta com o mesmo estado
    E posso ocultá-lo ao final
```

## US-037 — Texto alternativo de imagens

Como criadora, quero escrever descrições alternativas ou marcar imagens como decorativas, para gerar conteúdo acessível.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Texto alternativo de imagens

  Cenário: Rascunho descartado
    Dado que digitei uma descrição e fechei sem salvar
    Quando reabro após recarregar
    Então a descrição anterior continua

  Cenário: Salvar e marcar decorativa
    Quando salvo uma descrição
    Então ela persiste e é exportada no PDF e no HTML
    E uma imagem marcada como decorativa é ignorada por leitores de tela no export
```

## US-038 — Verificador de acessibilidade do documento

Como criadora, quero um verificador que lista problemas por categoria (texto alternativo, contraste, tamanho de fonte, ordem de leitura), para corrigir antes de publicar.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Verificador de acessibilidade do documento

  Cenário: Contagens refletem correções
    Dado um documento de duas páginas com imagens sem descrição
    Quando rodo o verificador
    Então vejo o total por categoria e cada problema aponta o elemento e a página
    Quando salvo uma descrição para uma das imagens e reabro o verificador
    Então a contagem de texto alternativo diminui em um
```

## US-039 — Bloquear export com problemas de acessibilidade

Como administradora de equipe, quero configurar categorias de problema que bloqueiam o export, para garantir conformidade nas publicações da organização.

- Prioridade: **Could**
- Onda alvo: **6**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Bloquear export com problemas de acessibilidade

  Cenário: Export bloqueado
    Dado a política que bloqueia imagens sem descrição
    Quando tento exportar um documento com esse problema
    Então vejo a lista de pendências e o export só segue após correção ou justificativa registrada
```
