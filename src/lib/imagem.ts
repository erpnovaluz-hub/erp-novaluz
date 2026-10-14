// Reduz foto do celular (4–8 MB) para JPEG ~1600px antes de enviar.
// Se o navegador não conseguir ler o formato (ex.: HEIC no Chrome), devolve o original.
export async function comprimirImagem(arq: File, ladoMax = 1600, qualidade = 0.8): Promise<Blob> {
  if (!arq.type.startsWith("image/")) return arq;
  try {
    const bmp = await createImageBitmap(arq);
    const escala = Math.min(1, ladoMax / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * escala), h = Math.round(bmp.height * escala);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", qualidade));
    return blob && blob.size < arq.size ? blob : arq;
  } catch {
    return arq;
  }
}
