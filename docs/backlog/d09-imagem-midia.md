# D09 — Imagem e mídia

Ajustes, transparência, inversão, recorte e remoção de fundo, sempre não destrutivos e iguais no editor e no export.

Histórias: 9. Rastreabilidade para os casos de origem em [rastreabilidade.csv](rastreabilidade.csv).

## US-083 — Ajustar brilho

Como criadora, quero ajustar o brilho de uma imagem, para corrigir fotos sem sair do editor.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Ajustar brilho

  Cenário: Persistência e export
    Dado uma imagem sem ajustes
    Quando defino brilho 20 e confirmo
    Então a prévia se atualiza e o valor persiste após recarregar
    E o PNG exportado reflete o mesmo ajuste do editor
    E a imagem original continua disponível
```

## US-084 — Desfazer e refazer ajustes

Como criadora, quero desfazer e refazer ajustes de imagem, para comparar versões rapidamente.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Desfazer e refazer ajustes

  Cenário: Controle acompanha o histórico
    Dado brilho 20 aplicado
    Quando desfaço
    Então a imagem e o controle voltam a 0
    Quando refaço
    Então ambos voltam a 20
```

## US-085 — Transparência com validação de valor

Como criadora, quero definir a transparência de uma imagem entre 0 e 100, para criar sobreposições.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Transparência com validação de valor

  Cenário: Valores fora da faixa
    Dado o campo de transparência
    Quando digito 150 ou -20
    Então o valor é limitado à faixa válida ao confirmar

  Cenário: Export com fundo opaco
    Dado transparência 50
    Quando exporto PNG sem fundo transparente
    Então a imagem aparece mesclada ao fundo da página como no editor
```

## US-086 — Inverter horizontal e verticalmente

Como criadora, quero espelhar imagens nos dois eixos, para ajustar composições.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Inverter horizontal e verticalmente

  Cenário: Espelho fiel
    Dado uma imagem
    Quando a inverto horizontalmente e exporto PNG
    Então o resultado é o reflexo exato da exportação original
    E inverter de novo restaura a orientação após recarregar
```

## US-087 — Menu de inversão acessível por teclado

Como pessoa usuária de teclado, quero abrir e operar o menu de inversão só com teclado, para editar sem mouse.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Menu de inversão acessível por teclado

  Cenário: Teclado
    Dado o foco no botão de inversão
    Quando pressiono Enter
    Então o menu abre com foco na primeira opção
    E Escape fecha o menu devolvendo o foco ao botão
```

## US-088 — Recortar com proporções e rotação

Como criadora, quero recortar imagens com proporções predefinidas e rotação fina, para enquadrar fotos.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: 3

```gherkin
# language: pt
Funcionalidade: Recortar com proporções e rotação

  Cenário: Aplicar 16:9
    Dado o modo de recorte
    Quando escolho 16:9 e confirmo
    Então o recorte persiste após reabrir

  Cenário: Cancelar descarta
    Quando escolho outra proporção, giro 15° e cancelo
    Então o recorte anterior é mantido

  Cenário: Voltar ao original
    Quando escolho a proporção original e confirmo
    Então a imagem volta ao enquadramento completo
```

## US-089 — Remover fundo localmente

Como criadora, quero remover o fundo de imagens no meu dispositivo, para recortar pessoas e objetos sem enviar fotos a terceiros.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Remover fundo localmente

  Cenário: On-device
    Dado uma imagem de 2 MP
    Quando removo o fundo com GPU integrada
    Então o resultado sai em até 2 segundos sem chamada de rede
    E há fallback no servidor quando o dispositivo não suporta
```

## US-090 — Refinar máscara com pincel

Como criadora, quero apagar ou restaurar áreas da máscara com pincel ajustável, para corrigir bordas que a remoção automática errou.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Refinar máscara com pincel

  Cenário: Pincel não destrutivo
    Dado uma imagem com fundo removido
    Quando restauro uma área com o pincel e aplico
    Então a máscara é atualizada e a mídia original continua guardada
    E cancelar descarta as pinceladas
    E tamanho, dureza e zoom do pincel são ajustáveis por teclado
```

## US-091 — Filtros e ajustes avançados

Como criadora, quero filtros e ajustes de contraste, saturação, temperatura e nitidez, para dar unidade visual às fotos.

- Prioridade: **Should**
- Onda alvo: **3**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Filtros e ajustes avançados

  Cenário: Pilha de ajustes
    Dado vários ajustes aplicados
    Então posso reordená-los e ocultá-los individualmente
```
