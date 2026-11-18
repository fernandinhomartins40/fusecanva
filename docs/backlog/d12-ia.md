# D12 — IA

Assistente com contexto, geração de texto e imagem, ampliação, conectores e provedores próprios ou locais.

Histórias: 8. Rastreabilidade para os casos de origem em [rastreabilidade.csv](rastreabilidade.csv).

## US-105 — Abrir o painel do assistente sem efeitos

Como criadora, quero abrir o painel do assistente de IA sem que nada seja gerado automaticamente, para controlar quando e o que é enviado ao modelo.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Abrir o painel do assistente sem efeitos

  Cenário: Nenhuma chamada implícita
    Dado o editor aberto
    Quando abro o painel do assistente e o fecho
    Então nenhuma requisição ao provedor de IA é feita
    E o foco volta ao ponto de origem
```

## US-106 — Conversar com o assistente

Como criadora, quero enviar uma mensagem de texto ao assistente e receber a resposta no mesmo fio, para obter ideias e textos.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Conversar com o assistente

  Cenário: Enviar e receber
    Dado um fio de conversa novo
    Quando escrevo um pedido curto e envio
    Então o campo é limpo, minha mensagem aparece no fio e a resposta chega em streaming
    E o botão de enviar fica desabilitado com o campo vazio

  Cenário: Erro do provedor
    Dado que o provedor está indisponível
    Então vejo uma mensagem de erro com opção de tentar de novo, sem perder o texto digitado
```

## US-107 — Anexar contexto ao pedido

Como criadora, quero um menu para anexar arquivos, seleção do canvas ou dados de apps ao pedido, para dar contexto ao assistente.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Anexar contexto ao pedido

  Cenário: Menu acessível
    Dado o compositor do assistente
    Quando abro o menu de anexos
    Então o botão é anunciado como expandido e as opções são navegáveis por Tab e Shift+Tab
    E Escape fecha o menu devolvendo o foco ao botão
```

## US-108 — Diretório de conectores do assistente

Como criadora, quero escolher fontes de dados conectadas ao assistente numa lista navegável, para usar meus dados com permissão explícita.

- Prioridade: **Should**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Diretório de conectores do assistente

  Cenário: Foco circular
    Dado o diretório de conectores aberto
    Quando percorro a lista com Tab até o fim
    Então o foco volta ao primeiro controle do diálogo sem escapar para a página
    E o foco é sempre visível
```

## US-109 — Gerar imagens e ampliar resolução

Como criadora, quero gerar imagens escolhendo proporção, estilo e qualidade, baixar e ampliar o resultado, para criar ilustrações próprias.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Gerar imagens e ampliar resolução

  Cenário: Gerar, baixar, ampliar e usar
    Dado um pedido com proporção 1:1
    Quando gero
    Então recebo um grupo de resultados
    E o arquivo baixado é idêntico à prévia exibida
    Quando amplio um resultado
    Então recebo uma versão com resolução maior
    E posso inseri-lo no design e exportá-lo
```

## US-110 — Detalhes e permissões de apps de IA

Como administradora de equipe, quero ver os detalhes, o fornecedor e as permissões de um app de IA antes de habilitá-lo, para decidir com informação.

- Prioridade: **Should**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Detalhes e permissões de apps de IA

  Cenário: Fechar sem mudar nada
    Dado a ficha de detalhes de um app de IA
    Quando navego pelas imagens de demonstração e fecho
    Então nenhuma permissão é concedida e o app continua no mesmo estado
```

## US-111 — Trazer a própria chave ou modelo local

Como operadora de self-host, quero configurar provedores compatíveis com OpenAI, Anthropic ou modelos locais, para controlar custo e privacidade.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Trazer a própria chave ou modelo local

  Cenário: Modelo local
    Dado um servidor de modelo local configurado
    Quando uso o assistente
    Então as requisições vão só para o servidor local
    E os logs registram uso sem armazenar conteúdo
```

## US-112 — Ações da IA sempre revisáveis

Como criadora, quero revisar e desfazer qualquer alteração feita pela IA no documento, para manter o controle do meu trabalho.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Ações da IA sempre revisáveis

  Cenário: Pré-visualizar antes de aplicar
    Dado uma sugestão de edição da IA
    Então vejo a prévia das mudanças
    E ao aplicar, a mudança entra como uma única ação desfazível
```
