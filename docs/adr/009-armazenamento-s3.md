# ADR-009 — Armazenamento S3-compatível com URLs pré-assinadas e content-addressing SHA-256

- **Status:** Aceito (plano v2, 17/11/2026)
- **Data:** 2026-11-17
- **Relacionados:** ADR-003, ADR-007, ADR-010

## Contexto

Hoje os arquivos de mídia ficam em disco local do servidor. Isso não escala horizontalmente, não funciona com CDN e complica o backup. A deduplicação por hash já existe e deve ser mantida.

## Decisão

- Armazenar assets em **object storage S3-compatível**. No self-host, o padrão é um serviço S3-compatível no `docker compose` (MinIO, conforme o plano); qualquer provedor que fale a API S3 serve.
- Upload direto do navegador por **URLs pré-assinadas**, com **multipart** para arquivos grandes; o servidor só emite a URL e confirma o upload.
- **Content-addressing:** chave = SHA-256 do conteúdo (`assets/<sha256>`), coerente com o formato `.fuse` (ADR-003) e com a deduplicação atual.
- Download por URL pré-assinada de curta duração, ou por CDN quando o asset for público.
- Um adapter de disco local fica disponível para o modo single-user desktop.

## Consequências

- **Positivas:** escala; CDN; deduplicação; o servidor não trafega bytes de mídia.
- **Negativas:** mais um serviço no self-host; configuração de CORS do bucket; a coleta de lixo de assets órfãos exige contagem de referências.
- **Atenção:** a licença e o modelo de distribuição do MinIO devem ser revisados antes de fixá-lo como padrão; se não servirem, usa-se outra implementação S3-compatível aberta. Decisão registrada como pendência.

## Alternativas consideradas

| Alternativa | Por que foi rejeitada |
| --- | --- |
| Disco local (estado atual) | Não escala nem funciona com CDN |
| Blobs no Postgres | Infla o banco e os backups |
| SDK proprietário de um único provedor | Lock-in; a API S3 é o padrão de fato |

## Versões verificadas (`npm view <pkg> version`, 17/11/2026)

| Pacote / serviço | Versão estável | Link oficial |
| --- | --- | --- |
| `@aws-sdk/client-s3` | 3.1171.0 | https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/ |
| `@aws-sdk/s3-request-presigner` | 3.1171.0 | https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/ |
| `minio` (cliente JS, opcional) | 8.0.7 | https://github.com/minio/minio-js |
| MinIO (servidor) | versão a verificar | https://min.io |
