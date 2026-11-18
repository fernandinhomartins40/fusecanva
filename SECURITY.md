# Política de segurança

## Versões com suporte

O Fuse Studio está em **pré-alpha**. Só a branch `main` recebe correções de segurança. Ainda não existem versões publicadas com suporte estendido.

| Versão | Suporte |
| --- | --- |
| `main` (pré-alpha) | sim |
| qualquer outra branch ou fork | não |

Quando a versão 1.0 sair, esta tabela passará a listar as versões estáveis com suporte.

## Como relatar uma vulnerabilidade

**Não abra issue, discussão ou PR público** sobre uma vulnerabilidade.

1. Use o **relato privado de vulnerabilidade do GitHub**: na página do repositório, abra a aba **Security** e clique em **Report a vulnerability**.
2. Se não conseguir usar esse canal, peça um contato privado às pessoas mantenedoras listadas em [GOVERNANCE.md](GOVERNANCE.md), sem incluir detalhes técnicos no pedido.

Inclua, se possível:

- o componente afetado (por exemplo `apps/web/server`, `packages/collab`, o plugin SDK ou a imagem Docker);
- a versão ou o commit;
- os passos para reproduzir ou uma prova de conceito mínima;
- o impacto esperado (vazamento de dados, execução de código, escalada de permissão etc.);
- se e como você gostaria de receber crédito.

## O que você pode esperar

| Etapa | Prazo alvo |
| --- | --- |
| Confirmação de recebimento | até 3 dias úteis |
| Avaliação inicial e classificação de severidade (CVSS) | até 10 dias úteis |
| Correção de severidade crítica ou alta | até 30 dias |
| Divulgação coordenada | até 90 dias após o relato, ou antes se houver correção publicada |

Por ser um projeto voluntário em pré-alpha, esses prazos são metas, não garantias. Mantemos você informado durante todo o processo e publicamos um *GitHub Security Advisory*, com crédito a você se quiser, quando a correção sair.

## Escopo

Estão no escopo:

- o código deste repositório (`apps/*`, `packages/*`, `infra/*`);
- a configuração padrão de auto-hospedagem em `infra/docker`;
- o isolamento de plugins (iframe sandbox e permissões do SDK);
- autenticação, autorização (ReBAC), links públicos e convites;
- o gateway de IA, inclusive o vazamento de chaves de provedores configuradas pela organização.

Estão fora do escopo:

- vulnerabilidades em dependências que já tenham aviso público (relate ao projeto de origem; nós atualizamos a dependência);
- instâncias de terceiros mal configuradas;
- ataques que exigem acesso físico ou uma conta de administrador já comprometida;
- negação de serviço por volume de tráfego;
- relatórios gerados só por scanner automático, sem demonstração de impacto.

## Porto seguro

Não tomaremos medidas contra quem pesquisar de boa-fé e seguir esta política: testar só em instâncias próprias, não acessar nem alterar dados de outras pessoas, não degradar serviços e dar tempo razoável para a correção antes de divulgar.

## Boas práticas para quem hospeda

- Nunca versione o arquivo `.env`. Use o `.env.example` como modelo.
- Troque todas as senhas e chaves padrão do `infra/docker` antes de expor a instância.
- Exponha a aplicação só por HTTPS, atrás de um proxy reverso.
- Mantenha a imagem e as dependências atualizadas.
