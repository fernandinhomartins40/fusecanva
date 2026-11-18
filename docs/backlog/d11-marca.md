# D11 — Marca

Kits de marca, paletas, estilos tipográficos, voz e revisão de conformidade.

Histórias: 6. Rastreabilidade para os casos de origem em [rastreabilidade.csv](rastreabilidade.csv).

## US-099 — Escolher kit de marca ativo

Como profissional de marketing, quero escolher qual kit de marca da organização está ativo no editor, para trabalhar para clientes ou marcas diferentes.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Escolher kit de marca ativo

  Cenário: Trocar kit
    Dado uma organização com dois kits
    Quando escolho o segundo kit no seletor
    Então paletas, fontes, logos e voz exibidos passam a ser os desse kit
```

## US-100 — Inserir texto com estilo tipográfico da marca

Como profissional de marketing, quero inserir títulos e textos já com os estilos da marca, para manter consistência sem configurar manualmente.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Inserir texto com estilo tipográfico da marca

  Cenário: Inserir sem seleção
    Dado nenhum texto selecionado
    Quando escolho o estilo de título da marca
    Então um novo texto é inserido com fonte, tamanho e cor do estilo
    E ele persiste após recarregar

  Cenário: Aplicar com seleção
    Dado um texto selecionado
    Quando escolho o estilo
    Então o estilo é aplicado ao texto existente em vez de criar outro
```

## US-101 — Aplicar paleta preservando a estrutura

Como profissional de marketing, quero aplicar a paleta da marca a um design inteiro, para adaptar materiais em um clique.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Aplicar paleta preservando a estrutura

  Cenário: Só cores mudam
    Dado um design com textos, formas e gráficos
    Quando aplico a paleta da marca
    Então preenchimentos, contornos e cores de texto são mapeados para a paleta
    E identificadores, tipos, textos e geometria dos elementos não mudam
    E a ação é desfazível em um passo
```

## US-102 — Revisão de conformidade com a marca

Como revisora de marca, quero uma revisão que aponte fontes e cores fora da marca com correção individual ou em lote, para garantir consistência antes de publicar.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Revisão de conformidade com a marca

  Cenário: Corrigir um e corrigir em lote
    Dado um design com 36 textos em fonte fora da marca
    Quando corrijo um problema individualmente
    Então só aquele elemento muda
    Quando seleciono os demais e aplico a correção em lote
    Então todos passam à fonte da marca, a contagem zera e o resultado persiste após recarregar
```

## US-103 — Voz e diretrizes da marca

Como profissional de marketing, quero registrar tom de voz e diretrizes no kit, para orientar pessoas e a IA ao escrever.

- Prioridade: **Should**
- Onda alvo: **3**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Voz e diretrizes da marca

  Cenário: Contexto para IA
    Dado diretrizes de voz no kit ativo
    Quando peço à IA um texto
    Então a requisição inclui as diretrizes como contexto, visível para mim
```

## US-104 — Modelos de marca

Como administradora de equipe, quero publicar modelos travados com elementos da marca, para que a equipe crie peças sem quebrar a identidade.

- Prioridade: **Should**
- Onda alvo: **3**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Modelos de marca

  Cenário: Elementos bloqueados
    Dado um modelo com logo bloqueado
    Quando uma pessoa editora usa o modelo
    Então ela não consegue mover nem apagar o logo
```
