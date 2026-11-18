# D07 — Apresentações

Notas, modo apresentador, tela cheia, janela separada e apresentação ao vivo. O corpus não traz casos executados deste domínio; as histórias derivam das capacidades observadas.

Histórias: 5. Rastreabilidade para os casos de origem em [rastreabilidade.csv](rastreabilidade.csv).

## US-067 — Notas do apresentador

Como apresentadora, quero escrever notas por slide, para ter roteiro durante a apresentação.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Notas do apresentador

  Cenário: Notas persistentes
    Dado um slide
    Quando escrevo notas e recarrego
    Então as notas continuam associadas ao slide
    E podem ser exportadas no PDF de notas
```

## US-068 — Modo apresentador

Como apresentadora, quero uma visão com slide atual, próximo, notas e cronômetro, para conduzir a apresentação com segurança.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Modo apresentador

  Cenário: Duas janelas sincronizadas
    Dado o modo apresentador aberto numa janela e a tela cheia em outra
    Quando avanço o slide pelo teclado
    Então as duas janelas avançam juntas
```

## US-069 — Tela cheia com navegação por teclado e toque

Como apresentadora, quero apresentar em tela cheia avançando por teclado, clique ou gesto, para apresentar em qualquer dispositivo.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Tela cheia com navegação por teclado e toque

  Cenário: Sair com Escape
    Dado a apresentação em tela cheia
    Quando pressiono Escape
    Então volto ao editor no slide em que parei
```

## US-070 — Apresentação ao vivo com plateia

Como apresentadora, quero compartilhar um link para a plateia acompanhar e reagir, para engajar pessoas remotas.

- Prioridade: **Could**
- Onda alvo: **5**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Apresentação ao vivo com plateia

  Cenário: Acompanhar
    Dado um link público de apresentação ao vivo
    Quando avanço um slide
    Então quem abriu o link vê o mesmo slide em até 1 segundo
```

## US-071 — Importar e exportar PPTX

Como apresentadora, quero abrir PPTX e exportar PPTX editável, para trabalhar com quem usa outras ferramentas.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Importar e exportar PPTX

  Cenário: Ida e volta
    Dado um PPTX com textos, imagens e notas
    Quando importo e exporto
    Então slides, notas e posições são preservados
```
