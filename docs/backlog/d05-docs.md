# D05 — Docs

Editor de documentos em blocos com tabelas, sumário, localizar e substituir, configuração de página e export em PDF.

Histórias: 12. Rastreabilidade para os casos de origem em [rastreabilidade.csv](rastreabilidade.csv).

## US-048 — Inserir bloco pela paleta rápida

Como redatora, quero inserir blocos (título, lista, tabela, imagem) por uma paleta pesquisável, para escrever sem tirar a mão do teclado.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Inserir bloco pela paleta rápida

  Cenário: Inserir tabela 4 × 3
    Dado o cursor num parágrafo vazio
    Quando abro a paleta e escolho uma tabela de 4 colunas e 3 linhas
    Então a tabela é inserida no ponto do cursor
    E persiste após recarregar
```

## US-049 — Preencher tabela e adicionar linhas pelo teclado

Como redatora, quero digitar nas células e criar linhas novas pelo teclado, para montar tabelas rapidamente.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Preencher tabela e adicionar linhas pelo teclado

  Cenário: Conteúdo e topologia preservados
    Dado uma tabela de 12 células preenchidas
    Quando salvo e recarrego
    Então o texto de cada célula e a estrutura são os mesmos
    Quando uso o atalho de nova linha na última célula
    Então uma linha vazia é adicionada e persiste
```

## US-050 — Reordenar linhas da tabela

Como redatora, quero mover linhas para cima e para baixo, para reorganizar dados sem recortar e colar.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Reordenar linhas da tabela

  Cenário: Descer e subir
    Dado a primeira linha selecionada
    Quando a movo para baixo
    Então ela passa a ser a segunda e isso persiste
    Quando a movo de volta para cima
    Então a ordem original é restaurada
    E as ações ficam disponíveis por teclado
```

## US-051 — Mesclar células

Como redatora, quero mesclar células adjacentes de uma linha, para criar cabeçalhos que abrangem colunas.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Mesclar células

  Cenário: Mesclar com desfazer e refazer
    Dado as células da primeira linha selecionadas
    Quando as mesclo
    Então a linha vira uma célula com o texto das originais
    Quando desfaço, as células voltam com seus identificadores e conteúdos
    Quando refaço, a mesclagem volta
    E o restante da tabela não muda
```

## US-052 — Desfazer mesclagem preservando texto

Como redatora, quero separar células mescladas sem perder o texto, para corrigir a estrutura com segurança.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Desfazer mesclagem preservando texto

  Cenário: Texto vai para a primeira célula
    Dado uma célula mesclada com texto
    Quando desfaço a mesclagem
    Então o texto fica na primeira célula resultante e as demais ficam vazias
    E o resultado persiste após recarregar
```

## US-053 — Espaçamento e bordas da tabela

Como redatora, quero ajustar o espaçamento interno das células e o estilo das bordas, para dar acabamento às tabelas.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Espaçamento e bordas da tabela

  Cenário: Padding e bordas pontilhadas
    Dado uma tabela com espaçamento interno de 12
    Quando altero para 20 e aplico bordas pontilhadas de espessura 2 em todas as células
    Então o editor e o PDF refletem ambos os valores após recarregar
```

## US-054 — Sumário navegável

Como leitora, quero um painel com a estrutura de títulos do documento, para saltar para seções em documentos longos.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Sumário navegável

  Cenário: Saltar para título
    Dado um documento com títulos
    Quando ativo um título no painel
    Então o editor rola até ele e o foco vai para o título
    E o painel marca a seção atual
```

## US-055 — Localizar e substituir

Como redatora, quero buscar com opção de diferenciar maiúsculas e substituir um ou todos, para revisar textos longos.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Localizar e substituir

  Cenário: Diferenciar maiúsculas
    Dado um texto com "Fuse" e "fuse"
    Quando busco "Fuse" com a opção de maiúsculas ativa
    Então só uma ocorrência é contada

  Cenário: Termo inexistente
    Quando busco um termo que não existe
    Então vejo zero resultados e as ações de substituir ficam desabilitadas

  Cenário: Substituir todos persiste
    Quando substituo todas as ocorrências e recarrego
    Então todas aparecem substituídas e posso desfazer em um passo
```

## US-056 — Configuração de página

Como redatora, quero escolher tamanho (A4, Carta), orientação e margens, para imprimir e exportar corretamente.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Configuração de página

  Cenário: A4 persistente
    Dado um documento em tamanho Carta
    Quando escolho A4
    Então a paginação se recalcula, a escolha persiste após recarregar e o PDF sai com páginas de 210 × 297 mm
```

## US-057 — PDF com paginação correta de tabelas longas

Como redatora, quero que tabelas longas quebrem entre páginas repetindo o cabeçalho, para entregar relatórios legíveis.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: PDF com paginação correta de tabelas longas

  Cenário: Cabeçalho repetido
    Dado uma tabela que ocupa três páginas A4
    Quando exporto em PDF
    Então cada página começa com a linha de cabeçalho
    E nenhuma linha é cortada ao meio
    E o PDF renderizado coincide com a pré-visualização do editor
```

## US-058 — PDF digital com texto selecionável na ordem certa

Como redatora, quero um PDF cujo texto extraído segue a ordem de leitura, para permitir busca, cópia e leitura acessível.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: PDF digital com texto selecionável na ordem certa

  Cenário: Ordem de extração
    Dado um documento com título, parágrafos e tabela
    Quando exporto como PDF digital
    Então o texto extraído segue a ordem do documento
    E as fontes estão embutidas
```

## US-059 — Importar e exportar DOCX

Como redatora, quero abrir arquivos DOCX e exportar para DOCX editável, para trocar arquivos com quem usa outros editores.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Importar e exportar DOCX

  Cenário: Ida e volta
    Dado um DOCX com títulos, listas e tabela
    Quando importo e exporto de novo
    Então estrutura e estilos básicos são preservados
```
