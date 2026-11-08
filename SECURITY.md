# Segurança e dados locais

Decisões Abertas recebe textos, notas e arquivos fornecidos pela pessoa que usa o aplicativo. A interface trata esses textos como conteúdo, sem interpretar HTML ou executar fórmulas de planilhas. O domínio valida o documento antes de aceitar uma alteração ou importação.

## Onde ficam os dados

A aplicação começa em sessão temporária, sem abrir o armazenamento. O salvamento em IndexedDB só é ativado por ação explícita e pertence à origem e ao perfil do navegador. Não há autenticação, sincronização entre dispositivos nem envio das comparações a um backend de negócio. O servidor de hospedagem continua recebendo as requisições normais dos arquivos estáticos do site.

O armazenamento local e os arquivos exportados não são cifrados pelo aplicativo. Uma pessoa com acesso ao perfil do navegador, ao dispositivo ou ao backup pode acessar e alterar seu conteúdo. Extensões do navegador e outros códigos executados na mesma origem também fazem parte do ambiente em que o aplicativo roda.

Use backups para conservar os documentos importantes. Excluir dados do site, usar navegação privada ou atingir a quota do navegador pode impedir a persistência. Em uma falha ou conflito de revisão, o documento em memória continua disponível para exportação; a aplicação não presume que uma gravação falhou ou foi confirmada sem o resultado da transação.

## Arquivos e registros históricos

O backup JSON é validado integralmente, com limite de 2 MiB na representação canônica UTF-8. Chaves extras, referências inválidas, tipos incorretos e textos fora do contrato são recusados. A leitura textual segue a semântica de `JSON.parse`: não há promessa de detectar chaves duplicadas antes de sua interpretação.

Markdown e CSV são relatórios, não backups de restauração. O CSV aplica um prefixo de apóstrofo a determinados textos para reduzir sua interpretação como fórmulas; planilhas e formas de importação podem tratar esses valores de modo diferente. Consulte [docs/FORMATO.md](docs/FORMATO.md).

Registros históricos preservam uma cópia local da matriz no momento em que são criados. Não são assinados, não autenticam a autoria ou o horário e podem ser alterados por quem editar o arquivo de backup. O aplicativo não verifica fontes externas nem garante a qualidade das informações usadas em uma decisão.

## Relatar um problema

Use o [relato privado de vulnerabilidade no GitHub](https://github.com/martinlofranodeoliveira/decisoes-abertas/security/advisories/new) quando disponível. Se esse canal não estiver habilitado, entre em contato pelo [site da LOFRANO TECNOLOGIA](https://lofranotecnologia.com.br) para combinar uma forma privada de compartilhar os detalhes. Não publique credenciais, backups reais ou dados de terceiros em issues.

Informe a versão ou o commit, o navegador, as etapas de reprodução e um arquivo sintético mínimo. Diferencie falha observada de suspeita; uma captura sem dados privados ou um exemplo reduzido costuma ser suficiente para iniciar a investigação.
