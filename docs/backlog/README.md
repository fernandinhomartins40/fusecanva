# Backlog do Fuse Studio

Histórias de usuário próprias, escritas a partir dos 14 domínios funcionais da análise
([docs/v2/01-ANALISE-PONTA-A-PONTA.md](../v2/01-ANALISE-PONTA-A-PONTA.md) §2.3) e dos 131 casos
de verificação herdados do plano v1. O texto é original: não reproduz rótulos de interface,
nomes internos nem microcopy de outros produtos. "Atende" significa passar na Definição de
Pronto do [plano v2](../v2/02-PLANO-V2.md) §6, não paridade visual.

## Convenções

- **ID:** `US-NNN`, sequencial e estável. Histórias novas recebem o próximo número livre; IDs não são reaproveitados.
- **Formato:** "Como <persona>, quero <capacidade>, para <valor>", seguido de critérios de aceite em Gherkin (PT).
- **Prioridade (MoSCoW):** Must = necessário para o gate da onda; Should = importante, pode escorregar uma onda; Could = desejável; Won't = fora desta versão.
- **Onda alvo:** conforme o roadmap do plano v2 §8 (0 fundação, 1 núcleo, 2 alpha, 3 mídia e marca, 4 beta, 5 publicação, 6 GA).
- **Casos de origem:** a ligação história ↔ caso fica só em [rastreabilidade.csv](rastreabilidade.csv). Linhas com `caso_original_id` vazio são capacidades do domínio sem caso correspondente.

## Índice

| Código | Domínio | Faixa de IDs | Histórias | Must/Should/Could | Ondas |
| --- | --- | --- | ---: | --- | --- |
| D01 | [Shell, projetos e organização](d01-shell-projetos.md) | US-001 a US-018 | 18 | 10/7/1 | 0, 1, 2 |
| D02 | [Modelo de documento e formato aberto](d02-modelo-documento.md) | US-019 a US-026 | 8 | 7/1/0 | 0, 1 |
| D03 | [Editor de canvas](d03-editor-canvas.md) | US-027 a US-039 | 13 | 9/3/1 | 1, 2, 6 |
| D04 | [Texto e tipografia](d04-texto-tipografia.md) | US-040 a US-047 | 8 | 3/5/0 | 1, 2 |
| D05 | [Docs](d05-docs.md) | US-048 a US-059 | 12 | 10/2/0 | 2 |
| D06 | [Planilhas](d06-planilhas.md) | US-060 a US-066 | 7 | 5/2/0 | 2 |
| D07 | [Apresentações](d07-apresentacoes.md) | US-067 a US-071 | 5 | 4/0/1 | 2, 5 |
| D08 | [Quadro branco](d08-quadro-branco.md) | US-072 a US-082 | 11 | 7/4/0 | 1, 2, 4 |
| D09 | [Imagem e mídia](d09-imagem-midia.md) | US-083 a US-091 | 9 | 8/1/0 | 3 |
| D10 | [Vídeo, áudio e animação](d10-video-audio-animacao.md) | US-092 a US-098 | 7 | 3/4/0 | 3 |
| D11 | [Marca](d11-marca.md) | US-099 a US-104 | 6 | 4/2/0 | 3 |
| D12 | [IA](d12-ia.md) | US-105 a US-112 | 8 | 6/2/0 | 4 |
| D13 | [Colaboração e equipe](d13-colaboracao-equipe.md) | US-113 a US-127 | 15 | 8/6/1 | 1, 4 |
| D14 | [Publicação e extensões](d14-publicacao-extensoes.md) | US-128 a US-156 | 29 | 18/8/3 | 2, 3, 4, 5, 6 |

Total: 156 histórias.

## Verificação

`node docs/backlog/verificar-rastreabilidade.mjs` confere que todo caso de `IMPLEMENTATION-STATUS.json`
aparece ao menos uma vez no CSV, que não há IDs de caso desconhecidos e que todo `US-NNN` do CSV existe nos arquivos de domínio.
