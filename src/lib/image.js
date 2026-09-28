import { dbGet, dbPut } from "./db.js";
import { getWebAppUrl } from "./sync.js";

/* ============================================================
   UTILITÁRIO DE IMAGEM — redimensiona/comprime antes de salvar
   ============================================================ */
export function fileToCompressedDataURL(file, maxDim, quality) {
  maxDim = maxDim || 1280;
  quality = quality || 0.72;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height = height * (maxDim / width); width = maxDim; }
      else if (height > maxDim) { width = width * (maxDim / height); height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ============================================================
   RESOLUÇÃO DE IMAGENS SINCRONIZADAS (vindas de outro dispositivo)
   Localmente, uma tarefa recém-criada já guarda a foto como base64
   (pronta para exibir). Depois de sincronizada, ela passa a guardar
   só o ID do arquivo no Drive — para exibir, busca-se a foto (em
   base64, via o próprio Apps Script) uma vez e guarda em cache local,
   então nas próximas vezes é instantâneo e funciona offline.
   ============================================================ */
export async function resolveImageSrc(valor) {
  if (!valor) return "";
  if (valor.indexOf("data:") === 0) return valor; // já é a imagem em si

  const cache = await dbGet("imageCache", valor);
  if (cache) return cache.dataUri;

  const url = await getWebAppUrl();
  if (!url) return "";
  try {
    const sep = url.indexOf("?") >= 0 ? "&" : "?";
    const res = await fetch(url + sep + "imagem=" + encodeURIComponent(valor));
    const data = await res.json();
    if (!data || !data.success) return "";
    const dataUri = "data:" + (data.mime || "image/jpeg") + ";base64," + data.base64;
    await dbPut("imageCache", { id: valor, dataUri });
    return dataUri;
  } catch (err) {
    return "";
  }
}
