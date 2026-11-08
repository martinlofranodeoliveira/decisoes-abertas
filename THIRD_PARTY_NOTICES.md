# Autoria e recursos de terceiros

O código e a documentação de Decisões Abertas são distribuídos sob [MIT](LICENSE), com `Copyright (c) 2026 Contribuidores da LOFRANO TECNOLOGIA`. Os recursos e ferramentas abaixo mantêm seus próprios termos.

## Infraestrutura da família LOFRANO

Os scripts de build, servidor local e verificação foram adaptados do [Caderno de Revisões](https://github.com/martinlofranodeoliveira/caderno-revisoes), também sob MIT e com o mesmo aviso de autoria de 2026. O texto integral dessa licença está em [LICENSE](LICENSE). Preserve a atribuição ao reutilizar os trechos correspondentes.

O ciclo de transações do adaptador [assets/store.mjs](assets/store.mjs) foi adaptado de Caderno de Revisões e [Garantia Aberta](https://github.com/martinlofranodeoliveira/garantia-aberta), sob a mesma licença MIT e aviso de autoria. A atribuição também permanece no cabeçalho do módulo.

A tipografia e a identidade visual seguem a família dos aplicativos abertos da LOFRANO TECNOLOGIA. Os exemplos de comparação deste projeto são inteiramente sintéticos.

## Fonte Lato

| Recurso incluído | Licença | Autoria |
| --- | --- | --- |
| `assets/lato-regular.ttf`, `assets/lato-bold.ttf` | SIL Open Font License 1.1 (`OFL-1.1`) | Copyright (c) 2010–2011, Łukasz Dziedzic |

O aviso de autoria e os termos completos acompanham as fontes em [assets/LATO-LICENSE.txt](assets/LATO-LICENSE.txt). A licença MIT da aplicação não substitui a licença desses arquivos. Preserve o aviso ao redistribuí-los.

O aviso de Lato herdado da família de aplicativos veio do pacote Debian e inclui condições separadas para arquivos `debian/*`. Esses arquivos de empacotamento não integram o aplicativo; as duas fontes acima permanecem sob OFL-1.1.

## Dependências de desenvolvimento

Não há dependências npm de execução no navegador. Os pacotes abaixo são usados somente nos testes; `node_modules/` não integra o site estático. As versões diretas são declaradas em `package.json`, e a árvore resolvida está em `package-lock.json`.

| Pacote | Versão | Uso | Licença |
| --- | --- | --- | --- |
| [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) | 6.2.7 | Exercitar transações de IndexedDB sem navegador | Apache License 2.0 |
| [linkedom](https://github.com/WebReflection/linkedom) | 0.18.15 | DOM simulado para testes da interface | ISC |

O aviso de `linkedom` é `Copyright (c) 2021, Andrea Giammarchi, @WebReflection`. Os termos integrais acompanham a instalação dos pacotes em seus arquivos `LICENSE`; dependências transitivas preservam os avisos em seus próprios pacotes. Caso redistribua as ferramentas de desenvolvimento, inclua também esses termos e avisos aplicáveis.
