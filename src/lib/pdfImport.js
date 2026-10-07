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

// Lê um PDF no formato "relatório": uma foto por página, com uma legenda
// de texto logo abaixo dela (e, só na primeira página, um título no topo).
// Devolve uma tarefa por página: { texto, imagemDataUrl }.
export async function extrairTarefasDoPdf(file, onProgress) {
  const pdfjsLib = await carregarPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const tarefas = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    if (onProgress) onProgress(i, pdf.numPages);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });

    // Posição de cada trecho de texto, já convertida para o mesmo sistema
    // de coordenadas da imagem renderizada (Y crescendo para baixo).
    const textContent = await page.getTextContent();
    const itens = textContent.items
      .filter((it) => it.str && it.str.trim())
      .map((it) => {
        const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
        return { texto: it.str, x, y };
      });

    const alturaPagina = viewport.height;
    const faixaTitulo = alturaPagina * 0.12;   // topo — só existe na 1ª página
    const faixaLegenda = alturaPagina * 0.85;  // tudo abaixo daqui é a legenda

    const itensTitulo = itens.filter((it) => it.y <= faixaTitulo);
    const itensLegenda = itens.filter((it) => it.y >= faixaLegenda);

    const linhaDeTexto = (lista) =>
      lista
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((it) => it.texto)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

    const texto = linhaDeTexto(itensLegenda);

    const topoRecorte = itensTitulo.length
      ? Math.max(...itensTitulo.map((it) => it.y)) + 6
      : 0;
    const baseRecorte = itensLegenda.length
      ? Math.min(...itensLegenda.map((it) => it.y)) - 6
      : alturaPagina;

    // renderiza a página inteira e recorta só a faixa onde está a foto
    const canvasPagina = document.createElement("canvas");
    canvasPagina.width = viewport.width;
    canvasPagina.height = viewport.height;
    await page.render({ canvasContext: canvasPagina.getContext("2d"), viewport }).promise;

    const altura = Math.max(baseRecorte - topoRecorte, 60);
    const canvasRecorte = document.createElement("canvas");
    canvasRecorte.width = viewport.width;
    canvasRecorte.height = altura;
    canvasRecorte.getContext("2d").drawImage(
      canvasPagina, 0, topoRecorte, viewport.width, altura, 0, 0, viewport.width, altura
    );

    tarefas.push({
      texto: texto || "",
      imagemDataUrl: compressCanvas(canvasRecorte, 1280, 0.75)
    });
  }

  return tarefas;
}
