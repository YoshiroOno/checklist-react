import { compressCanvas } from "./image.js";

// PDF.js só é carregado quando a importação é realmente usada — não pesa
// no carregamento normal do app. Vem de um CDN público, como o React.
const PDFJS_VERSION = "3.11.174";
let pdfjsLibPromise = null;

function carregarScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = src;
    tag.onload = resolve;
    tag.onerror = () => reject(new Error("Falha ao carregar " + src));
    document.head.appendChild(tag);
  });
}

async function carregarPdfJs() {
  if (pdfjsLibPromise) return pdfjsLibPromise;
  pdfjsLibPromise = (async () => {
    if (!window.pdfjsLib) {
      await carregarScript(`https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`);
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;
    return window.pdfjsLib;
  })();
  return pdfjsLibPromise;
}

// Agrupa os trechos de texto da página em "linhas" (Y parecido) e monta o
// texto de cada linha respeitando o vão real entre os pedaços — só coloca
// espaço onde realmente há um vão visível, em vez de sempre colocar um
// espaço entre cada pedacinho (o que gerava espaços sobrando no meio das
// palavras).
function agruparEmLinhas(itens) {
  const ordenados = itens.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const linhas = [];
  for (const it of ordenados) {
    const ultima = linhas[linhas.length - 1];
    if (ultima && Math.abs(it.y - ultima.y) < 6) {
      ultima.itens.push(it);
    } else {
      linhas.push({ y: it.y, itens: [it] });
    }
  }
  return linhas.map((linha) => {
    const itensDaLinha = linha.itens.slice().sort((a, b) => a.x - b.x);
    let texto = "";
    let fimAnterior = null;
    let topoY = Infinity;
    let baseY = -Infinity;
    for (const it of itensDaLinha) {
      if (fimAnterior !== null) {
        const vao = it.x - fimAnterior;
        if (vao > 2 && !/\s$/.test(texto)) texto += " ";
      }
      texto += it.texto;
      fimAnterior = it.x + it.largura;
      topoY = Math.min(topoY, it.topoY);
      baseY = Math.max(baseY, it.baseY);
    }
    return { texto: texto.replace(/\s+/g, " ").trim(), topoY, baseY };
  });
}

// Remove as bordas brancas em volta da foto: a margem da página e, nas
// fotos em retrato, o espaço em branco ao lado (elas não ocupam a largura
// toda). Só corta linhas/colunas praticamente 100% brancas, então não come
// parte de uma foto que tenha uma área clara na borda.
function recortarBordasBrancas(canvas) {
  const { width, height } = canvas;
  const dados = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  const LIMITE = 248;

  const naoBranco = (x, y) => {
    const i = (y * width + x) * 4;
    return dados[i] < LIMITE || dados[i + 1] < LIMITE || dados[i + 2] < LIMITE;
  };
  const linhaVazia = (y) => {
    let achados = 0;
    for (let x = 0; x < width; x += 2) {
      if (naoBranco(x, y) && ++achados > 2) return false;
    }
    return true;
  };
  const colunaVazia = (x, de, ate) => {
    let achados = 0;
    for (let y = de; y < ate; y += 2) {
      if (naoBranco(x, y) && ++achados > 2) return false;
    }
    return true;
  };

  let topo = 0;
  while (topo < height && linhaVazia(topo)) topo++;
  let base = height - 1;
  while (base > topo && linhaVazia(base)) base--;
  let esq = 0;
  while (esq < width && colunaVazia(esq, topo, base + 1)) esq++;
  let dir = width - 1;
  while (dir > esq && colunaVazia(dir, topo, base + 1)) dir--;

  const w = dir - esq + 1;
  const h = base - topo + 1;
  if (w < 40 || h < 40) return canvas; // não achou nada razoável — mantém como está

  const saida = document.createElement("canvas");
  saida.width = w;
  saida.height = h;
  saida.getContext("2d").drawImage(canvas, esq, topo, w, h, 0, 0, w, h);
  return saida;
}

// Lê um PDF no formato "relatório": uma foto por página, com uma legenda
// de texto logo abaixo dela (e, só na primeira página, um título no topo).
// A posição da legenda varia bastante conforme a foto é em retrato (preenche
// quase a página toda) ou paisagem (fica bem mais alta) — por isso a
// legenda é sempre a última linha de texto da página, onde quer que ela
// esteja, e não uma porcentagem fixa da altura. Devolve uma tarefa por
// página: { texto, imagemDataUrl }.
export async function extrairTarefasDoPdf(file, onProgress) {
  const pdfjsLib = await carregarPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const tarefas = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    if (onProgress) onProgress(i, pdf.numPages);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });

    // Posição (e altura aproximada) de cada trecho de texto, já convertida
    // para o mesmo sistema de coordenadas da imagem renderizada.
    const textContent = await page.getTextContent();
    const itens = textContent.items
      .filter((it) => it.str && it.str.trim())
      .map((it) => {
        const [x, baseY] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
        const altura = (it.height || 0) * viewport.scale;
        return { texto: it.str, x, y: baseY, baseY, topoY: baseY - altura, largura: (it.width || 0) * viewport.scale };
      });

    const linhas = agruparEmLinhas(itens).sort((a, b) => a.topoY - b.topoY);

    // A última linha é sempre a legenda, esteja ela onde estiver. Se houver
    // mais de uma linha, a primeira é o título (só acontece na página 1) —
    // com uma única linha na página, ela é a legenda, não o título, mesmo
    // que não esteja perto do rodapé (caso de foto em paisagem).
    let tituloFimY = 0;
    let legendaTopoY = viewport.height;
    let texto = "";
    if (linhas.length >= 2) {
      tituloFimY = linhas[0].baseY;
      const legenda = linhas[linhas.length - 1];
      legendaTopoY = legenda.topoY;
      texto = legenda.texto;
    } else if (linhas.length === 1) {
      legendaTopoY = linhas[0].topoY;
      texto = linhas[0].texto;
    }

    const margem = 6;
    const topoRecorte = Math.max(0, tituloFimY + margem);
    const baseRecorte = Math.min(
      viewport.height,
      Math.max(legendaTopoY - margem, topoRecorte + 40)
    );

    // renderiza a página inteira e recorta só a faixa onde está a foto
    const canvasPagina = document.createElement("canvas");
    canvasPagina.width = viewport.width;
    canvasPagina.height = viewport.height;
    await page.render({ canvasContext: canvasPagina.getContext("2d"), viewport }).promise;

    const altura = baseRecorte - topoRecorte;
    const canvasRecorte = document.createElement("canvas");
    canvasRecorte.width = viewport.width;
    canvasRecorte.height = altura;
    canvasRecorte.getContext("2d").drawImage(
      canvasPagina, 0, topoRecorte, viewport.width, altura, 0, 0, viewport.width, altura
    );

    tarefas.push({
      texto,
      imagemDataUrl: compressCanvas(recortarBordasBrancas(canvasRecorte), 1280, 0.75)
    });
  }

  return tarefas;
}
