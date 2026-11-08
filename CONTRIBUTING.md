# Contribuir

Contribuições são bem-vindas para tornar as comparações mais claras, preservar os dados e melhorar o uso no computador e no celular. Leia [PRODUCT.md](PRODUCT.md) e [SPEC.md](SPEC.md) antes de alterar regras de cálculo ou armazenamento.

## Preparar o ambiente

Use Node.js 22 ou superior e instale a árvore de dependências registrada no lockfile:

```sh
npm ci
npm run dev
```

Os dados de exemplo devem ser fictícios. Não inclua backups pessoais, informações de terceiros, credenciais ou arquivos operacionais na contribuição.

## Verificar uma alteração

```sh
npm test
npm run build
npm run check
npm run preview
```

`check` verifica também os arquivos de `dist/`; o build deve vir antes dele e da prévia em uma cópia nova do repositório.

Os testes de domínio e formatos usam entradas sintéticas. As verificações de IndexedDB usam `fake-indexeddb`; as de interface usam um DOM simulado por `linkedom`. Esses testes não substituem abrir a aplicação em um navegador real.

Se alterar a interface, confira em computador e celular: foco visível, navegação por teclado, nomes de campos, matrizes largas, mensagens de erro e retorno ao fluxo após cancelar um diálogo. Relate o que foi exercitado e os ambientes usados; não apresente uma simulação de DOM como revisão visual ou teste com tecnologia assistiva.

## Preservar o contrato

- Uma resposta ausente continua ausente. Não substitua `null` por zero nem renormalize os pesos separadamente para cada alternativa.
- Só apresente ranking quando todas as alternativas tiverem notas nos critérios ativos. Compare pontos inteiros antes de arredondar a apresentação.
- O registro de escolha é separado da classificação. Um empate ou uma escolha diferente do primeiro lugar deve permanecer visível.
- Registros históricos são cópias da matriz original. Edições e remoções atuais não podem modificá-los.
- Importações e comandos inválidos falham integralmente, mantendo o documento anterior.
- O domínio é puro: IDs e horários vêm do chamador. Não introduza relógio, rede, armazenamento ou geração de IDs nesse módulo.
- Salvamento local é opcional. Um conflito de revisão não autoriza sobrescrever dados mais recentes.
- Mudanças no formato exigem contrato, testes e caminho de compatibilidade explícitos. Não altere o significado de `schemaVersion: 1` silenciosamente.

## Enviar uma proposta

Abra uma issue ou pull request com o problema observado, o comportamento esperado e um exemplo mínimo sintético. Para código, descreva a mudança e sua validação; inclua regressões para defeitos corrigidos e atualize a documentação quando o comportamento público mudar.

Evite dependências de execução para funções que o projeto já resolve com a plataforma web. Uma nova dependência precisa de finalidade, licença e impacto no build e na distribuição documentados. Mantenha `package-lock.json` coerente com `package.json`; não edite o lockfile manualmente para simular uma instalação.

O código e a documentação são distribuídos sob [MIT](LICENSE). Preserve autoria e avisos de terceiros. Para problemas que possam expor dados ou executar conteúdo importado, siga [SECURITY.md](SECURITY.md), sem publicar o material privado em uma issue.
