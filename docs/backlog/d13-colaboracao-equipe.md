# D13 — Colaboração e equipe

Compartilhamento, papéis, comentários, versões, presença e administração da organização.

Histórias: 15. Rastreabilidade para os casos de origem em [rastreabilidade.csv](rastreabilidade.csv).

## US-113 — Ver níveis de acesso antes de compartilhar

Como criadora, quero abrir o painel de compartilhamento e navegar entre pessoas, níveis e configurações sem alterar nada por acidente, para compartilhar com segurança.

- Prioridade: **Must**
- Onda alvo: **1**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Ver níveis de acesso antes de compartilhar

  Cenário: Navegação sem alteração
    Dado o painel de compartilhamento
    Quando listo os níveis de acesso sem escolher, abro as configurações e volto
    Então nenhuma permissão é alterada
    E Escape fecha a lista aberta sem fechar o painel inteiro
```

## US-114 — Papéis por documento e link público

Como criadora, quero convidar pessoas como editoras, comentaristas ou leitoras e gerar link público, para colaborar com o nível certo de acesso.

- Prioridade: **Must**
- Onda alvo: **1**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Papéis por documento e link público

  Cenário: Permissões aplicadas no servidor
    Dado uma pessoa leitora
    Quando ela tenta editar via API
    Então o servidor recusa a operação
```

## US-115 — Presença, seguir e destaque

Como criadora, quero ver cursores de quem está no documento, seguir alguém e chamar atenção da equipe para minha tela, para conduzir revisões ao vivo.

- Prioridade: **Should**
- Onda alvo: **1**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Presença, seguir e destaque

  Cenário: Seguir
    Dado outra pessoa no documento
    Quando escolho segui-la
    Então minha visualização acompanha a dela até eu interagir
```

## US-116 — Modo comentário com filtros

Como revisora, quero alternar para modo comentário e filtrar comentários por estado e ordem, para revisar sem alterar o conteúdo.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Modo comentário com filtros

  Cenário: Filtro sem resultados
    Dado um documento sem comentários resolvidos
    Quando filtro por resolvidos
    Então vejo um estado vazio com ação para limpar o filtro
    E limpar o filtro volta à lista completa

  Cenário: Sem edição no modo comentário
    Dado o modo comentário
    Então as ferramentas de edição ficam indisponíveis
```

## US-117 — Comentários com menções e notificações

Como revisora, quero mencionar pessoas em comentários e notificá-las, para pedir ação de quem precisa agir.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Comentários com menções e notificações

  Cenário: Menção
    Dado um comentário com uma menção
    Quando publico
    Então a pessoa mencionada recebe notificação no app e, se configurado, por e-mail
```

## US-118 — Histórico de versões e cópia de versão antiga

Como criadora, quero navegar pelo histórico e criar uma cópia a partir de uma versão antiga, para recuperar trabalho sem perder o atual.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Histórico de versões e cópia de versão antiga

  Cenário: Copiar versão
    Dado o histórico de um documento
    Quando escolho a primeira versão e crio uma cópia
    Então um novo documento surge com o conteúdo daquela versão
    E o original continua no estado atual
```

## US-119 — Versões nomeadas, variantes e comparação visual

Como criadora, quero nomear versões, criar variantes e comparar duas versões visualmente, para testar alternativas como em controle de versão.

- Prioridade: **Should**
- Onda alvo: **4**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Versões nomeadas, variantes e comparação visual

  Cenário: Comparar
    Dado duas versões nomeadas
    Quando as comparo
    Então vejo elementos adicionados, removidos e alterados destacados
```

## US-120 — Diretório de pessoas da equipe

Como administradora de equipe, quero ver as pessoas da organização com papel e estado, para gerenciar a equipe.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Diretório de pessoas da equipe

  Cenário: Somente leitura por padrão
    Dado a tela de pessoas
    Então vejo nome, e-mail, papel e data de entrada de cada pessoa
    E nenhuma ação de convite ou papel é executada sem confirmação
```

## US-121 — Política de downloads

Como administradora de equipe, quero definir quem pode baixar arquivos da organização, para proteger material confidencial.

- Prioridade: **Should**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Política de downloads

  Cenário: Inspecionar e cancelar
    Dado o seletor de política de download aberto
    Quando pressiono Escape sem escolher
    Então a política anterior permanece após recarregar
```

## US-122 — Política de uploads

Como administradora de equipe, quero definir quem pode enviar arquivos e para onde, para controlar o armazenamento.

- Prioridade: **Should**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Política de uploads

  Cenário: Inspecionar e cancelar
    Dado o seletor de escopo de upload aberto
    Quando fecho sem escolher e recarrego
    Então o escopo anterior permanece
```

## US-123 — Gerenciar integrações da equipe

Como administradora de equipe, quero buscar e habilitar integrações para a organização com salvar explícito, para decidir quais serviços externos a equipe usa.

- Prioridade: **Should**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Gerenciar integrações da equipe

  Cenário: Fechar sem salvar
    Dado o gerenciador de integrações
    Quando busco um termo sem resultados, limpo e fecho sem salvar
    Então as integrações habilitadas continuam as mesmas após recarregar
```

## US-124 — Menu de ações de app da equipe

Como administradora de equipe, quero abrir o menu de ações de um app instalado e buscar apps sem disparar ações, para administrar apps com segurança.

- Prioridade: **Could**
- Onda alvo: **4**
- Casos de origem: 1

```gherkin
# language: pt
Funcionalidade: Menu de ações de app da equipe

  Cenário: Escape não executa
    Dado o menu de ações de um app
    Quando pressiono Escape
    Então o menu fecha sem executar nenhuma ação
    E limpar a busca restaura a lista completa
```

## US-125 — SSO e verificação de domínio

Como administradora de equipe, quero configurar login único via SAML/OIDC e verificar o domínio da organização, para centralizar o acesso corporativo.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: SSO e verificação de domínio

  Cenário: Domínio verificado
    Dado um domínio verificado
    Quando alguém com e-mail desse domínio entra
    Então é associado à organização conforme a política
```

## US-126 — Aprovações de design

Como revisora, quero aprovar ou pedir mudanças em um design antes da publicação, para formalizar a governança.

- Prioridade: **Should**
- Onda alvo: **4**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Aprovações de design

  Cenário: Fluxo de aprovação
    Dado um design enviado para aprovação
    Quando peço mudanças
    Então a autora é notificada e o design fica marcado como pendente
```

## US-127 — Auditoria

Como administradora de equipe, quero um registro de ações administrativas e de compartilhamento, para atender exigências de conformidade.

- Prioridade: **Must**
- Onda alvo: **4**
- Casos de origem: nenhum (capacidade do domínio)

```gherkin
# language: pt
Funcionalidade: Auditoria

  Cenário: Registro
    Dado uma alteração de papel
    Então o registro mostra quem, quando, o quê e de onde
```
