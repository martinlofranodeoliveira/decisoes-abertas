---
name: Decisões Abertas
description: Instrumento de comparação da família visual LOFRANO, com cálculo visível e decisão humana.
colors:
  ink: "#19212e"
  muted: "#596474"
  accent: "#ae185c"
  accent-hover: "#8c134a"
  canvas: "#f0f2f6"
  paper: "#fff"
  line: "#d8dde5"
  control: "#b7c1cf"
  frame: "#17202d"
  rose: "#f9edf3"
  danger: "#a51d36"
  focus: "#b23975"
typography:
  headline:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "27px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.35
  small-title:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.35
  text-action:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  score:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
rounded:
  compact: "4px"
  field: "6px"
  control: "7px"
  feedback: "8px"
  surface: "12px"
spacing:
  tight: "8px"
  inline: "12px"
  inset: "16px"
  section-small: "20px"
  section: "24px"
  workspace: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-secondary-hover:
    backgroundColor: "{colors.rose}"
    textColor: "{colors.ink}"
  button-text:
    textColor: "{colors.accent}"
    typography: "{typography.text-action}"
    padding: "7px 0"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  area-navigation:
    textColor: "{colors.muted}"
    padding: "12px 0"
  comparison-navigation:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px"
  comparison-navigation-current:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
  comparison-count:
    rounded: "{rounded.compact}"
    padding: "1px 5px"
  surface:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.surface}"
    padding: "24px"
  rating:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "7px 10px"
    width: "65px"
    height: "43px"
  notice:
    backgroundColor: "{colors.rose}"
    rounded: "{rounded.feedback}"
    padding: "13px 16px"
---

# Design System: Decisões Abertas

## Overview

**Creative North Star: "Instrumento de comparação LOFRANO"**

A interface herda a marca, a tipografia local e a linguagem de controles dos aplicativos abertos da LOFRANO TECNOLOGIA. O enquadramento escuro reúne a identificação institucional; o espaço de trabalho combina fundo frio, papel branco e linhas discretas. O rosa orienta ações, localização atual e resultados sem transformar toda a superfície em destaque.

A densidade serve à leitura de critérios, notas e justificativas. Títulos e números criam hierarquia dentro de uma ferramenta sóbria, sem imagens decorativas. Esta descrição registra o código e as capturas finais; o nome acima descreve o sistema observado, sem atribuir uma escolha de metáfora ou uma aprovação humana.

**Key Characteristics:**
- Lato local em pesos regular e negrito.
- Frame institucional escuro e superfícies claras planas.
- Rosa compartilhado por ações, navegação atual e pontuação.
- Comparação tabular no computador e fichas completas no celular.
- Estados ausentes e resultados incompletos escritos por extenso.

## Colors

A paleta tem um acento rosa e uma base de neutros frios. Os valores normativos estão no frontmatter e correspondem às propriedades de `assets/app.css`. As rampas OKLCH no sidecar são amostras sintetizadas para a prévia do painel; não são novas cores de uso da interface.

### Primary

- **Rosa de ação** (`accent`): botões primários, links, aba atual, comparação selecionada e números de pontuação completa.
- **Rosa profundo** (`accent-hover`): resposta de hover das ações primárias e textuais.
- **Rosa de papel** (`rose`): avisos e hover dos botões secundários.
- **Rosa de foco** (`focus`): contorno de foco visível nos controles e elementos focalizáveis.
- **Vermelho de remoção** (`danger`): ações destrutivas textuais. O estado de erro também tem fundo e borda próprios no CSS; não é uma segunda cor de marca.

### Neutral

- **Tinta fria** (`ink`): texto principal e notas.
- **Tinta secundária** (`muted`): ajuda, descrições, pesos e estados auxiliares.
- **Plano frio** (`canvas`): fundo contínuo do aplicativo.
- **Papel** (`paper`): superfícies de trabalho, campos e controles secundários; texto invertido no cabeçalho e no botão primário.
- **Linha** (`line`): divisórias estruturais, bordas das superfícies e separação de linhas da matriz.
- **Contorno de controle** (`control`): bordas dos campos e seletores de nota.
- **Frame institucional** (`frame`): barra superior.

**The Rosa de Estado Rule.** Use o rosa nas ações, no item atual e na pontuação como no sistema existente; acompanhe estados com rótulo, forma ou posição, preservando seu significado textual.

## Typography

**Display Font:** Lato, com Arial e sans-serif como alternativas.
**Body Font:** Lato, com os mesmos fallbacks. Os arquivos locais regular e bold são carregados por `@font-face`, com `font-display: swap` e sem síntese de fonte.

**Character:** uma só família mantém a ferramenta familiar e compacta. Negrito identifica títulos, rótulos de controle e valores; números de notas, pontuações e cálculos usam algarismos tabulares.

### Hierarchy

- **Headline:** título do contexto; a variação no celular usa (24px). O estado inicial usa um título maior, sem estabelecer outra família tipográfica.
- **Title:** títulos de seções e superfícies; a matriz reduz seu título no celular para (17px).
- **Small title:** títulos internos de análise e registros, com variações locais conforme a densidade.
- **Body:** a base está no frontmatter; o conteúdo de trabalho usa em geral (13px), e campos usam (14px), ampliados para (16px) no celular.
- **Label:** botões primários e secundários; as ações textuais conservam peso regular.
- **Score:** destaque de resultado completo; no espaço intermediário usa (21px) e nas fichas móveis (23px). Intervalos incompletos têm tamanho menor e cor de tinta, acompanhados da lacuna textual.
- **Ajuda e metadados:** tamanhos entre (10px) e (12px); descrições de critério usam (11px), com entrelinha (1.5). Blocos de ajuda e contexto limitam a leitura em geral a (75ch).

**The Número com Contexto Rule.** Pontuação sempre permanece junto da alternativa e do texto de posição ou de incompletude; não substitua esse contexto por cor.

## Layout

O cabeçalho ocupa a largura disponível; o aplicativo e o rodapé têm largura máxima de (1560px). A estrutura de computador usa uma lateral de (224px) e uma coluna principal flexível, com `minmax(0, 1fr)`. A lateral passa para (195px) até (1150px). O espaço de trabalho começa com recuo horizontal de (32px), cai para (23px) na faixa intermediária e para (18px) no celular. O ritmo recorrente está no frontmatter.

A matriz é uma superfície contínua. A coluna de critérios reserva (190px); a largura mínima total é `190px + 140px × N`, para uma a oito alternativas. A tabela conserva colunas proporcionais e rolagem horizontal própria quando necessário; a página não depende de cortar o conteúdo para caber. O invólucro rolável participa do foco de teclado e tem nome acessível.

Até (760px), a tabela fica oculta e cada alternativa ganha uma ficha vertical. Cada ficha repete nome, resultado e todos os critérios com peso, descrição quando existente, seletor de nota e observação. A explicação da escala de zero a cinco permanece acima das fichas. A linha de avaliação usa uma coluna flexível de texto e outra de (100px) para o controle. A lateral vira uma faixa superior; a lista de comparações pode rolar horizontalmente. As abas continuam visíveis, e formulários e painéis se empilham.

**The Conteúdo Completo Rule.** A adaptação para fichas preserva os rótulos, as descrições, a escala e o significado das notas; não reduza a comparação a números isolados.

## Elevation & Depth

O sistema é plano e não usa sombras. A profundidade vem da barra institucional escura, do contraste entre plano frio e papel, de bordas finas e de separadores internos. Cabeçalhos da tabela e estados inativos usam variações tonais leves; avisos usam papel rosa. Editores e confirmações permanecem no fluxo, com contorno mais marcado.

As transições existentes afetam cor de fundo, texto e borda de botões e links por (0.16s), com `ease-out`. A preferência por movimento reduzido elimina transições e animações. A implementação não estabelece uma animação de entrada nem uma animação de célula editada.

## Shapes

Superfícies grandes têm cantos suaves; controles usam raios menores e consistentes, conforme o frontmatter. Bordas são finas, sem contornos pesados ou recortes decorativos. O marcador de estado de armazenamento é um ponto pequeno, acompanhado de texto. O símbolo institucional é o SVG geométrico já presente no cabeçalho; não há coleção de ilustrações.

## Components

### Buttons

Controles compactos, com rótulos explícitos. Primário usa rosa e texto de papel; secundário usa papel e borda discreta. A altura mínima habitual é (42px), e a variante compacta usa (36px). O secundário muda para papel rosa e borda rosada em hover. A ação textual usa sublinhado, altura mínima de (34px) e pode receber cor de remoção. Desabilitados ficam com opacidade (0.5) e cursor de indisponibilidade.

O foco visível usa contorno de (3px) e afastamento de (3px), inclusive nos links, campos e elementos com `tabindex`. O link de pular para o trabalho aparece ao receber foco. Após reconstruir a interface, uma nota editada conserva o foco pelo identificador `data-focus`; quando isso não é possível, o aplicativo dirige o foco para o título ou a região de trabalho. Isso descreve o comportamento implementado, sem declarar uma certificação geral de acessibilidade.

### Inputs / Fields

Campos de papel com borda de controle, raio pequeno e altura mínima de (43px). Rótulos ficam acima, separados por (6px). Áreas de texto permitem redimensionamento vertical. O cursor de texto usa rosa de ação. No celular, o tamanho da fonte dos campos aumenta para facilitar a edição.

### Navigation

As áreas da comparação usam botões textuais sobre uma linha comum. A aba atual combina rosa, negrito e uma linha inferior de (3px), com `aria-current="page"`. A comparação atual na lateral combina papel, borda, rosa e negrito; as demais recebem fundo tonal em hover. O acesso ao código aberto aparece no cabeçalho do computador e fica oculto no celular.

### Chips

O contador do caderno é uma pequena etiqueta neutra, com texto de (11px), largura mínima de (22px) e cantos compactos. É uma contagem, sem aparência de ação ou filtro.

### Cards / Containers

Papel com borda de linha, raio de superfície e recuo habitual de (24px), reduzido a (20px) no celular. A matriz ajusta o recuo superior e lateral para conter uma tabela ou as fichas sem criar cartões adicionais por célula. Avisos usam raio de feedback e papel rosa. Mensagens de erro preservam texto explícito e ação própria quando disponível.

### Matriz e fichas de alternativa

O nome de cada alternativa é um botão sublinhado junto de sua pontuação. Cada critério mantém nome editável, peso e descrição opcional. O seletor oferece ausência e notas inteiras de zero a cinco; ausência usa borda tracejada. Notas quatro e cinco recebem um tom rosa leve, enquanto a nota continua explícita. Critérios de peso zero são identificados como inativos e usam fundo neutro discreto na tabela.

Antes de completar as notas ativas, o cabeçalho exibe um intervalo possível e um texto de pendência, sem posição de ranking. Com todos os dados ativos, apresenta percentual e posição, incluindo empate quando aplicável. A observação permanece uma ação textual separada do seletor. Nas fichas móveis, a mesma leitura se organiza em linhas identificadas, sem exigir arrastar a matriz.

## Do's and Don'ts

### Do:

- **Do** preservar Lato local, frame escuro, plano frio e papel como base comum da família LOFRANO.
- **Do** manter o resultado junto da alternativa e explicar por texto notas ausentes, intervalos e empates.
- **Do** preservar descrições, pesos, escala e observações na passagem da tabela para as fichas.
- **Do** manter foco visível e sua restauração após atualizar uma nota.
- **Do** construir separação com tonalidade, borda e espaçamento, como nas superfícies existentes.

### Don't:

- **Don't** transformar a paleta de estados em uma segunda identidade de marca.
- **Don't** exibir posição de ranking enquanto houver notas ativas ausentes.
- **Don't** tratar a pontuação como escolha automática ou recomendação do aplicativo.
- **Don't** converter descrições de critério ou ajuda de escala em conteúdo exclusivo do computador.
- **Don't** registrar intenções de animação, aprovação humana ou certificação geral de acessibilidade como fatos desta implementação.
