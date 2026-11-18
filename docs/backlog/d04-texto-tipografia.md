# D04 — Texto e tipografia

Motor de texto, espaçamentos, kerning, ligaduras, fontes abertas e revisão tipográfica.

Histórias: 8. Rastreabilidade para os casos de origem em [rastreabilidade.csv](rastreabilidade.csv).

## US-040 — Ajustar entrelinha

Como criadora, quero definir a altura de linha de um bloco de texto, para controlar a densidade do texto.

- Prioridade: **Must**
- Onda alvo: **1**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Ajustar entrelinha

  Cenário: Valor persistente e idêntico no export
    Dado um bloco de texto com entrelinha 1,4
    Quando altero para 2 e confirmo
    Então o layout se recalcula imediatamente
    E após recarregar o valor continua 2
    E o PNG e o PDF exportados têm as mesmas quebras de linha do editor
```

## US-041 — Ligar e desligar kerning

Como criadora, quero ativar ou desativar o kerning de um trecho, para ajustar a aparência de títulos.

- Prioridade: **Should**
- Onda alvo: **1**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Ligar e desligar kerning

  Cenário: Kerning persistente
    Dado um trecho com kerning ativo
    Quando desativo o kerning
    Então o espaçamento entre pares muda no editor e no export
    E o estado persiste após recarregar e pode ser revertido
```

## US-042 — Ligaduras, sobrescrito e espaçamento de letras

Como criadora, quero controlar ligaduras, sobrescrito/subscrito e espaçamento entre letras, para compor tipografia profissional.

- Prioridade: **Should**
- Onda alvo: **1**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Ligaduras, sobrescrito e espaçamento de letras

  Cenário: Medição idêntica
    Dado um texto com ligaduras e sobrescrito
    Então a largura medida no navegador e no render headless é a mesma
```

## US-043 — Fontes abertas com metadados

Como criadora, quero uma biblioteca de fontes de licença aberta com pesos, estilos e eixos variáveis corretos, para usar fontes sem risco de licença.

- Prioridade: **Must**
- Onda alvo: **1**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Fontes abertas com metadados

  Cenário: Família, peso e faixa unicode
    Dado uma fonte instalada da biblioteca
    Então cada face declara família, peso, estilo, eixos e faixa unicode
    E o texto renderizado usa a face declarada, sem substituição silenciosa
    E a licença de cada fonte está registrada no manifesto de assets
```

## US-044 — Escrita em vários sistemas

Como criadora, quero escrever em latim com acentos, árabe e CJK básico, para atender públicos de vários idiomas.

- Prioridade: **Should**
- Onda alvo: **1**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Escrita em vários sistemas

  Cenário: Direção e quebra
    Dado um texto em árabe
    Então ele é exibido da direita para a esquerda com formas contextuais corretas
```

## US-045 — Revisão de legibilidade com navegação por problema

Como criadora, quero ver cartões de problemas tipográficos (por exemplo texto pequeno demais) que me levam ao elemento, para corrigir rápido em documentos longos.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Revisão de legibilidade com navegação por problema

  Cenário: Ir até o problema
    Dado um cartão de problema referente à página 3
    Quando ativo o cartão
    Então o editor navega para a página 3, seleciona o elemento e marca o cartão como ativo
```

## US-046 — Seleção múltipla de problemas tipográficos

Como criadora, quero marcar vários problemas para corrigir de uma vez, para economizar tempo.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Seleção múltipla de problemas tipográficos

  Cenário: Marcar e desmarcar
    Dado dois problemas listados
    Quando marco ambos e depois desmarco um a um
    Então o contador de selecionados acompanha cada mudança
    E recarregar não deixa seleção residual
```

## US-047 — Correção coletiva desfazível

Como criadora, quero aplicar uma correção tipográfica a todos os problemas selecionados e desfazer com um comando, para experimentar sem medo.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Correção coletiva desfazível

  Cenário: Desfazer em lote
    Dado seis textos abaixo do tamanho mínimo
    Quando aplico a correção coletiva
    Então todos passam ao tamanho sugerido e a contagem de problemas zera
    Quando desfaço uma vez
    Então todos voltam ao tamanho anterior e o estado persiste após recarregar
```
