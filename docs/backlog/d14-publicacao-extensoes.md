# D14 — Publicação e extensões

Export multiformato, sites, apps e plugins, criação em lote, impressão e domínios próprios.

Histórias: 29. Rastreabilidade para os casos de origem em [rastreabilidade.csv](rastreabilidade.csv).

## US-128 — Escolher formato de export com prontidão clara

Como criadora, quero escolher o formato de export num painel que mostra opções disponíveis e o que cada uma exige, para baixar exatamente o que preciso.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Escolher formato de export com prontidão clara

  Cenário: Lista de formatos
    Dado o painel de export aberto
    Quando expando a escolha de formato
    Então vejo PNG, JPG, SVG, PDF, GIF, MP4 e formatos editáveis compatíveis com o tipo de documento
    E o formato escolhido é lembrado no próximo export
```

## US-129 — Controles específicos por formato com verificação do arquivo

Como criadora, quero ajustar opções próprias de cada formato (escala, qualidade, páginas, fundo transparente), para controlar o resultado final.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Controles específicos por formato com verificação do arquivo

  Cenário: Opção refletida no arquivo
    Dado export PNG com escala 2×
    Quando exporto
    Então o arquivo tem o dobro das dimensões da página
    E o resultado da tarefa e o download são confirmados separadamente
```

## US-130 — Histórico de exports

Como criadora, quero ver os exports já gerados, com formato, data e origem, para baixar de novo sem refazer.

- Prioridade: **Could**
- Onda alvo: **2**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Histórico de exports

  Cenário: Linhagem
    Dado um export concluído
    Então ele aparece no histórico com hash, formato, versão do documento de origem e link para baixar
```

## US-131 — Achatar PDF

Como criadora, quero exportar PDF achatado e cancelar a qualquer momento, para evitar edições no arquivo entregue.

- Prioridade: **Should**
- Onda alvo: **3**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Achatar PDF

  Cenário: Cancelamento
    Dado um export de PDF achatado em andamento
    Quando cancelo
    Então a tarefa para e nenhum arquivo parcial é entregue
```

## US-132 — Compactar PDF

Como criadora, quero reduzir o tamanho do PDF com uma opção de compressão, para enviar por e-mail.

- Prioridade: **Should**
- Onda alvo: **3**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Compactar PDF

  Cenário: Menor e legível
    Dado um documento com fotos
    Quando exporto com compressão ligada
    Então o arquivo é menor que o export sem compressão
    E texto e vetores permanecem nítidos
```

## US-133 — PDF acessível com estrutura marcada

Como criadora, quero PDFs com árvore de tags, ordem de leitura e textos alternativos, para cumprir requisitos de acessibilidade (PDF/UA).

- Prioridade: **Must**
- Onda alvo: **6**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: PDF acessível com estrutura marcada

  Cenário: Estrutura validada
    Dado um documento com títulos, listas, tabela e imagens descritas
    Quando exporto PDF acessível
    Então a árvore de tags reflete a estrutura
    E um validador de PDF/UA não aponta erros bloqueantes
```

## US-134 — Render headless e CLI

Como desenvolvedora de integrações, quero renderizar arquivos .fuse por linha de comando e API, para automatizar peças em pipelines.

- Prioridade: **Must**
- Onda alvo: **2**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Render headless e CLI

  Cenário: CLI
    Dado um arquivo .fuse
    Quando rodo o comando de render para PDF
    Então o PDF gerado é igual ao export do editor
```

## US-135 — Criação em lote a partir de dados

Como profissional de marketing, quero gerar vários designs a partir de uma planilha ou entrada manual, para produzir peças personalizadas em escala.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Criação em lote a partir de dados

  Cenário: Fontes de dados
    Dado o fluxo de criação em lote
    Então posso escolher entrada manual, CSV ou XLSX
    E vejo os formatos aceitos antes de enviar o arquivo
    E sair do fluxo não altera o design
```

## US-136 — Editar a tabela de dados manual

Como profissional de marketing, quero digitar, limpar e cancelar dados na tabela manual, para preparar os registros sem arquivo externo.

- Prioridade: **Should**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Editar a tabela de dados manual

  Cenário: Cancelar descarta
    Dado dados digitados na tabela manual
    Quando limpo a tabela e cancelo
    Então nada é salvo e o design não muda após recarregar
```

## US-137 — Vincular campos de dados a elementos

Como profissional de marketing, quero ligar colunas de dados a textos, imagens e cores do design, para definir o que varia em cada peça.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Vincular campos de dados a elementos

  Cenário: Vincular e desvincular
    Dado um título selecionado
    Quando o vinculo à coluna "Nome" e salvo
    Então o vínculo persiste após recarregar
    Quando removo o vínculo e salvo
    Então o título volta a ser texto fixo
```

## US-138 — Pré-visualizar e gerar os registros

Como profissional de marketing, quero pré-visualizar cada registro e gerar os designs, para conferir antes de produzir.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Pré-visualizar e gerar os registros

  Cenário: Dois registros
    Dado duas linhas de dados vinculadas
    Quando navego pelas prévias 1 de 2 e 2 de 2
    Então cada prévia mostra os dados da linha
    Quando gero
    Então os designs aparecem nos meus projetos e reabrem com os dados corretos
```

## US-139 — Opções de saída do lote

Como profissional de marketing, quero escolher entre um documento único ou arquivos individuais nomeados por uma coluna, para organizar a entrega.

- Prioridade: **Should**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Opções de saída do lote

  Cenário: Nome por coluna
    Dado a saída em arquivos individuais
    Quando escolho nomear pela coluna "Nome"
    Então cada arquivo recebe o valor da linha
    E voltar para documento único restaura o nome original
```

## US-140 — Configurações avançadas de PDF no lote

Como profissional de marketing, quero definir predefinição, páginas e senha do PDF gerado em lote, para proteger arquivos distribuídos.

- Prioridade: **Should**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Configurações avançadas de PDF no lote

  Cenário: Senha opcional
    Dado as configurações avançadas
    Quando ativo a senha
    Então vejo um indicador de força e um valor sugerido, sem que ele seja copiado automaticamente
    Quando desativo e recarrego
    Então as configurações voltam ao estado anterior
```

## US-141 — Marketplace de apps: navegação e busca

Como criadora, quero navegar por categorias e buscar apps num marketplace comunitário, para estender o editor.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: 3

```gherkin
# language: pt
Funcionalidade: Marketplace de apps: navegação e busca

  Cenário: Categoria
    Dado o marketplace
    Quando escolho uma categoria
    Então a lista e o endereço refletem a categoria e ela é anunciada como selecionada

  Cenário: Busca com sugestões
    Quando digito um termo sem enviar
    Então vejo sugestões e a lista não muda
    Quando envio
    Então os resultados aparecem
    E limpar a busca restaura a categoria anterior
```

## US-142 — Recomendações de apps

Como criadora, quero um carrossel de apps recomendados navegável por teclado, para descobrir extensões úteis.

- Prioridade: **Could**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Recomendações de apps

  Cenário: Teclado
    Dado o carrossel de recomendações
    Então cada cartão é um botão com nome acessível
    E o controle de próxima página move o foco de forma previsível
```

## US-143 — Ficha do app com permissões declaradas

Como criadora, quero ver fornecedor, idiomas e permissões de um app antes de abri-lo, para decidir se confio no app.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Ficha do app com permissões declaradas

  Cenário: Voltar preserva o catálogo
    Dado a ficha de um app
    Então vejo as permissões declaradas no manifesto
    Quando volto
    Então o catálogo está como antes
```

## US-144 — Busca de apps no editor acessível por teclado

Como pessoa usuária de teclado, quero navegar entre o campo de busca de apps e o botão de limpar com Tab e Shift+Tab, para usar apps sem mouse.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Busca de apps no editor acessível por teclado

  Cenário: Foco visível
    Dado o foco no campo de busca de apps com texto
    Quando pressiono Tab
    Então o foco vai para o botão de limpar e é visível
    E Shift+Tab devolve o foco ao campo
```

## US-145 — SDK de plugins em sandbox

Como desenvolvedora de plugins, quero um SDK com RPC tipado, iframe isolado e manifesto de permissões, para publicar plugins com segurança.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: SDK de plugins em sandbox

  Cenário: Permissão negada
    Dado um plugin sem permissão de rede
    Quando ele tenta acessar a rede
    Então a chamada é bloqueada e registrada
```

## US-146 — Sites: páginas e navegação

Como criadora, quero criar sites com várias páginas e barra de navegação, para publicar presença online sem programar.

- Prioridade: **Must**
- Onda alvo: **5**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Sites: páginas e navegação

  Cenário: Segunda página
    Dado um site com uma página
    Quando adiciono e nomeio a segunda página e ativo a navegação
    Então a barra mostra os nomes das páginas na prévia
    E desativar a barra e excluir a página restaura o estado inicial após recarregar
```

## US-147 — Sites: adicionar, ordenar e excluir seções

Como criadora, quero adicionar, mover e excluir seções de uma página, para estruturar o conteúdo.

- Prioridade: **Must**
- Onda alvo: **5**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Sites: adicionar, ordenar e excluir seções

  Cenário: Mover seção
    Dado a segunda seção selecionada
    Quando a movo para cima
    Então ela vira a primeira e a opção de subir fica desabilitada
    E a ordem persiste após recarregar

  Cenário: Adicionar e excluir
    Quando adiciono uma seção
    Então ela entra na última posição
    E excluí-la restaura a página original
```

## US-148 — Sites: duplicar seções com edição independente

Como criadora, quero duplicar seções e editá-las separadamente, para reaproveitar layout.

- Prioridade: **Must**
- Onda alvo: **5**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Sites: duplicar seções com edição independente

  Cenário: Cópia independente
    Dado uma seção duplicada
    Quando edito o título da cópia
    Então o título da original não muda após recarregar
```

## US-149 — Sites: ocultar e exibir seções

Como criadora, quero ocultar seções sem excluí-las, para preparar conteúdo antes de publicar.

- Prioridade: **Should**
- Onda alvo: **5**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Sites: ocultar e exibir seções

  Cenário: Oculta na prévia
    Dado uma seção oculta
    Então ela não aparece na prévia de computador nem no site publicado
    E exibir de novo a restaura na mesma posição
```

## US-150 — Sites: prévia por dispositivo

Como criadora, quero alternar a prévia entre computador e celular, para conferir o responsivo antes de publicar.

- Prioridade: **Must**
- Onda alvo: **5**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Sites: prévia por dispositivo

  Cenário: Alternar e fechar
    Dado a prévia aberta
    Quando alterno entre computador e celular e fecho
    Então o rascunho não muda após recarregar
```

## US-151 — Sites: menu de navegação no celular

Como visitante do site, quero um menu recolhível no celular que leva às páginas e fecha corretamente, para navegar no site pelo telefone.

- Prioridade: **Must**
- Onda alvo: **5**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Sites: menu de navegação no celular

  Cenário: Seguir link
    Dado o menu aberto na prévia de celular
    Quando escolho a segunda página
    Então ela abre e o menu fecha
    E o botão de fechar e Escape fecham o menu devolvendo o foco
```

## US-152 — Sites: ajuste de títulos no celular

Como criadora, quero que títulos se ajustem automaticamente no celular, com opção de desligar, para evitar textos cortados.

- Prioridade: **Should**
- Onda alvo: **5**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Sites: ajuste de títulos no celular

  Cenário: Ajuste ligado e desligado
    Dado um título longo
    Então na prévia de celular ele cabe na largura
    Quando desligo o ajuste
    Então o tamanho original é usado em ambas as prévias, e religar restaura o ajuste
```

## US-153 — Sites: domínio próprio

Como criadora, quero conectar um domínio próprio ao site publicado com HTTPS, para ter um endereço profissional.

- Prioridade: **Must**
- Onda alvo: **5**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Sites: domínio próprio

  Cenário: Rascunho de domínio
    Dado o diálogo de adicionar domínio com texto digitado
    Quando fecho e reabro na mesma página
    Então o rascunho é mantido
    E ao navegar para outra tela e voltar, o campo começa vazio

  Cenário: Verificação
    Dado um domínio com DNS configurado
    Então o certificado HTTPS é emitido e o site responde nesse domínio
```

## US-154 — Impressão: variantes de produto

Como criadora, quero escolher papel e quantidade de produtos impressos com preço atualizado, para encomendar material gráfico.

- Prioridade: **Should**
- Onda alvo: **5**
- Casos de origem: 2

```gherkin
# language: pt
Funcionalidade: Impressão: variantes de produto

  Cenário: Troca reversível
    Dado um cartão de visita com papel premium e quantidade 150
    Quando mudo para papel padrão e quantidade 50
    Então preço e resumo se atualizam
    E restaurar os valores originais restaura o preço
```

## US-155 — Preflight e PDF/X para gráfica

Como criadora, quero verificar sangria, resolução, cores e fontes e gerar PDF/X, para enviar arquivos sem retrabalho na gráfica.

- Prioridade: **Must**
- Onda alvo: **5**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Preflight e PDF/X para gráfica

  Cenário: Preflight
    Dado uma imagem abaixo de 300 dpi no tamanho de impressão
    Quando rodo o preflight
    Então recebo um alerta com a página e o elemento
```

## US-156 — Planejador de conteúdo

Como profissional de marketing, quero um calendário para planejar e agendar publicações, para organizar campanhas.

- Prioridade: **Could**
- Onda alvo: **5**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Planejador de conteúdo

  Cenário: Agendar
    Dado um design pronto
    Quando o agendo para uma data num provedor configurado
    Então ele aparece no calendário com o estado agendado
```
