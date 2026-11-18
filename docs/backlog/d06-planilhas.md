# D06 — Planilhas

Grade esparsa, fórmulas, recálculo, erros, mesclagem, formatação e gráficos.

Histórias: 7. Rastreabilidade para os casos de origem em [rastreabilidade.csv](rastreabilidade.csv).

## US-060 — Recalcular dependências ao editar fórmula

Como analista, quero que células dependentes se recalculem quando altero uma fórmula, para confiar nos resultados.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Recalcular dependências ao editar fórmula

  Cenário: Recalcular e persistir
    Dado A1 com uma fórmula usada por outras células
    Quando troco o último termo de 0 para 2 e confirmo
    Então todas as dependentes mostram o novo resultado
    E após recarregar os valores continuam corretos
    E trocar de volta para 0 restaura os resultados originais
```

## US-061 — Erros de fórmula claros e desfazíveis

Como analista, quero ver erros como divisão por zero com explicação e desfazer a edição que os causou, para corrigir planilhas sem medo.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Erros de fórmula claros e desfazíveis

  Cenário: Divisão por zero
    Dado uma célula com fórmula válida
    Quando a altero para dividir por zero
    Então a célula mostra o erro e uma dica explica a causa
    Quando desfaço
    Então a fórmula e o valor anteriores voltam e isso persiste após recarregar
```

## US-062 — Barra de fórmula previsível ao reabrir

Como analista, quero que a barra de fórmula e a seleção se comportem de forma previsível ao reabrir a planilha, para não sobrescrever fórmulas por acidente.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Barra de fórmula previsível ao reabrir

  Cenário: Reabrir sem edição pendente
    Dado que selecionei todo o texto da fórmula e recarreguei
    Quando a planilha reabre
    Então nenhuma edição está em andamento e os valores são os mesmos
    E Escape cancela qualquer edição iniciada sem alterar a célula
```

## US-063 — Mesclar e desmesclar células da planilha

Como analista, quero mesclar intervalos e desfazer a mesclagem, para montar cabeçalhos de relatórios.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Mesclar e desmesclar células da planilha

  Cenário: Ciclo completo
    Dado o intervalo A5:B5 selecionado
    Quando escolho mesclar no menu de contexto
    Então o intervalo vira uma célula e persiste ao reabrir
    Quando desmesclo
    Então A5 e B5 voltam a ser células independentes
```

## US-064 — Biblioteca ampla de funções

Como analista, quero mais de 300 funções em português e inglês, para migrar planilhas existentes sem reescrever fórmulas.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Biblioteca ampla de funções

  Cenário: Funções de busca
    Dado uma tabela de preços
    Quando uso uma função de busca vertical em PT-BR ou em inglês
    Então ambos os nomes produzem o mesmo resultado
```

## US-065 — Gráficos ligados a intervalos

Como analista, quero criar gráficos a partir de intervalos que se atualizam com os dados, para comunicar números visualmente.

- Prioridade: **Should**
- Onda alvo: **2**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Gráficos ligados a intervalos

  Cenário: Atualização ao vivo
    Dado um gráfico de barras ligado a B2:B6
    Quando altero B3
    Então a barra correspondente se atualiza
```

## US-066 — Importar e exportar XLSX e CSV

Como analista, quero abrir e salvar XLSX e CSV, para trocar dados com outras ferramentas.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Importar e exportar XLSX e CSV

  Cenário: Fórmulas preservadas
    Dado um XLSX com fórmulas e células mescladas
    Quando importo e exporto
    Então fórmulas, mesclagens e formatos numéricos são preservados
```
