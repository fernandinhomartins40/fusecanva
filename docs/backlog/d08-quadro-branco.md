# D08 — Quadro branco

Dock de ferramentas, linhas e conectores, camadas, notas adesivas, apps embutidos e sincronização ao vivo.

Histórias: 11. Rastreabilidade para os casos de origem em [rastreabilidade.csv](rastreabilidade.csv).

## US-072 — Dock de ferramentas do quadro

Como facilitadora, quero um dock flutuante com ferramentas e indicação clara da ativa, para trocar de ferramenta rapidamente.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Dock de ferramentas do quadro

  Cenário: Ferramenta ativa anunciada
    Dado o quadro aberto
    Quando escolho a ferramenta de nota adesiva
    Então ela fica visualmente ativa e é anunciada como pressionada
    E as demais ficam como não pressionadas
```

## US-073 — Biblioteca de linhas

Como facilitadora, quero escolher entre variantes de linha (reta, curva, cotovelo) num submenu, para desenhar diagramas.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Biblioteca de linhas

  Cenário: Submenu previsível
    Dado a ferramenta de linhas
    Quando abro o submenu de variantes
    Então cada variante tem nome acessível
    Quando escolho a ferramenta de seleção
    Então o submenu fecha e volto ao modo neutro
```

## US-074 — Marcadores de ponta e curvatura

Como facilitadora, quero definir setas nas pontas e transformar linhas em curvas, para indicar fluxo em diagramas.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Marcadores de ponta e curvatura

  Cenário: Seta e curva persistentes
    Dado uma linha reta
    Quando aplico seta na ponta final e mudo para curva
    Então a linha mostra a seta e a curvatura
    E ambos persistem após recarregar
```

## US-075 — Inverter pontas da linha

Como facilitadora, quero trocar o início e o fim de uma linha, para corrigir a direção de uma seta.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Inverter pontas da linha

  Cenário: Inverter duas vezes
    Dado uma linha com seta no fim
    Quando inverto as pontas
    Então a seta passa para o início e o estado é anunciado
    E inverter de novo restaura o original após recarregar
```

## US-076 — Conectores ancorados

Como facilitadora, quero ligar linhas a objetos de modo que acompanhem o movimento, para manter diagramas organizados ao reorganizar.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Conectores ancorados

  Cenário: Âncora segue o objeto
    Dado um conector ligado a duas formas
    Quando movo uma das formas
    Então a ponta do conector acompanha o ponto de ancoragem
    E após recarregar a ligação continua
```

## US-077 — Selecionar objeto encoberto pelas camadas

Como facilitadora, quero selecionar pelo painel de camadas um objeto escondido sob outro, para editar o que não consigo clicar.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Selecionar objeto encoberto pelas camadas

  Cenário: Seleção pela lista
    Dado uma linha encoberta por uma imagem
    Quando escolho a linha no painel de camadas
    Então a linha fica selecionada com alças visíveis
```

## US-078 — Trazer para frente e enviar para trás

Como facilitadora, quero mudar a ordem de empilhamento dos objetos, para controlar sobreposições.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Trazer para frente e enviar para trás

  Cenário: Ida e volta da ordem
    Dado um objeto no topo
    Quando o envio para trás
    Então ele passa para o fundo
    Quando o trago para o topo e recarrego
    Então a ordem original está preservada
```

## US-079 — Sincronização entre abas e pessoas

Como facilitadora, quero ver alterações feitas em outra aba ou por outra pessoa sem recarregar, para colaborar ao vivo.

- Prioridade: **Must**
- Onda alvo: **1**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Sincronização entre abas e pessoas

  Cenário: Duas abas
    Dado o mesmo quadro aberto em duas abas
    Quando altero uma linha na segunda aba
    Então a primeira aba mostra a mudança em até 1 segundo sem recarregar
```

## US-080 — Encontrar e inserir apps no quadro

Como facilitadora, quero buscar apps (por exemplo gerador de QR) de dentro do quadro, para enriquecer o quadro sem sair dele.

- Prioridade: **Should**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Encontrar e inserir apps no quadro

  Cenário: Busca de apps
    Dado a aba de apps no quadro
    Quando busco "QR"
    Então a lista mostra os apps instalados ou disponíveis que correspondem
```

## US-081 — QR code editável com validação

Como facilitadora, quero gerar QR codes com URL validada e estilos de padrão, para compartilhar links no material.

- Prioridade: **Should**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: QR code editável com validação

  Cenário: URL inválida
    Dado o painel do gerador de QR
    Quando digito uma URL inválida
    Então vejo a mensagem de validação e a ação de salvar fica desabilitada

  Cenário: Padrão persistente
    Quando escolho um padrão de módulos circulares e recarrego
    Então o QR mantém o padrão e continua legível por leitores comuns
```

## US-082 — Notas adesivas e votação

Como facilitadora, quero criar notas adesivas coloridas e rodar votações, para conduzir dinâmicas de grupo.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Notas adesivas e votação

  Cenário: Votar
    Dado uma sessão de votação com 3 votos por pessoa
    Quando cada participante vota nas notas
    Então o resultado agregado é exibido ao encerrar
```
