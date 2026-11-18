# D10 — Vídeo, áudio e animação

Timeline multifaixa, cortes, sincronização com batida, animações e render no servidor.

Histórias: 7. Rastreabilidade para os casos de origem em [rastreabilidade.csv](rastreabilidade.csv).

## US-092 — Timeline multifaixa

Como editora de vídeo, quero uma timeline com faixas de vídeo, áudio, texto e imagem, para montar vídeos curtos no mesmo app.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Timeline multifaixa

  Cenário: Operações básicas
    Dado um clipe na timeline
    Quando divido, aparo e desloco o conteúdo dentro do clipe
    Então cada operação é desfazível e persiste após recarregar
    E controles de faixa, clipe, playhead, volume, fades e transições são acessíveis por teclado
```

## US-093 — Sincronizar cortes com a batida

Como editora de vídeo, quero alinhar automaticamente cortes à batida da música, para fazer vídeos ritmados sem esforço.

- Prioridade: **Should**
- Onda alvo: **3**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Sincronizar cortes com a batida

  Cenário: Sincronizar e restaurar
    Dado uma faixa de áudio e clipes na timeline
    Quando aciono a sincronização
    Então os limites dos clipes se alinham aos onsets detectados
    E o resultado persiste após recarregar
    E posso restaurar as durações originais de cada clipe e título
```

## US-094 — Marcadores de batida visíveis

Como editora de vídeo, quero exibir ou ocultar marcadores de batida na timeline, para editar manualmente no ritmo.

- Prioridade: **Should**
- Onda alvo: **3**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Marcadores de batida visíveis

  Cenário: Alternar
    Dado os marcadores ocultos
    Quando ativo a exibição
    Então os marcadores aparecem e o controle é anunciado como ligado
    E desligar e recarregar não altera o conteúdo do documento
```

## US-095 — Animações com export em vídeo

Como criadora, quero animar elementos e páginas e exportar MP4, para publicar conteúdo animado.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Animações com export em vídeo

  Cenário: Parâmetros persistentes
    Dado uma animação de entrada configurada
    Quando salvo, reabro e exporto MP4
    Então o vídeo mostra a animação com a duração e o easing definidos
```

## US-096 — Keyframes com easing

Como editora de vídeo, quero animar propriedades com keyframes e curvas de easing, para criar movimento refinado.

- Prioridade: **Should**
- Onda alvo: **3**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Keyframes com easing

  Cenário: Curva aplicada
    Dado dois keyframes de posição com easing de saída
    Então a prévia e o export seguem a mesma curva
```

## US-097 — Render de vídeo no servidor

Como editora de vídeo, quero que o export de vídeo rode num worker com progresso e cancelamento, para não travar meu computador.

- Prioridade: **Must**
- Onda alvo: **3**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Render de vídeo no servidor

  Cenário: Meta de desempenho
    Dado um vídeo de 60 s com 3 faixas e áudio
    Quando exporto MP4
    Então o worker conclui em até 30 s, mostrando progresso
    E posso cancelar a qualquer momento
```

## US-098 — Legendas e texto temporizado

Como editora de vídeo, quero adicionar legendas com tempo e importar SRT/VTT, para tornar vídeos acessíveis.

- Prioridade: **Should**
- Onda alvo: **3**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Legendas e texto temporizado

  Cenário: Importar SRT
    Dado um arquivo SRT
    Quando o importo
    Então cada legenda vira um texto temporizado na faixa de legendas
```
