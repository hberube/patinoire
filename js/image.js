// Prepares a team image in the browser: photos are centre-cropped to a square,
// images with transparency (logos) are fitted whole. Mirrors scripts/set_logo.py,
// which re-encodes everything again on the server side.

export async function prepareImage(file, size = 512, maxBytes = Infinity) {
  if (!file.type.startsWith("image/")) throw new Error("not-image");
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("not-image"); });

  // Detect transparency on a small sample
  const probe = new OffscreenCanvas(64, 64).getContext("2d");
  probe.drawImage(bitmap, 0, 0, 64, 64);
  const alpha = probe.getImageData(0, 0, 64, 64).data;
  let transparent = false;
  for (let i = 3; i < alpha.length; i += 4) if (alpha[i] < 250) { transparent = true; break; }

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  const { width: w, height: h } = bitmap;
  if (transparent) {
    const k = Math.min(size / w, size / h);
    ctx.drawImage(bitmap, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k);
  } else {
    const side = Math.min(w, h);
    ctx.drawImage(bitmap, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  }

  // WebP keeps transparency and is small; fall back to PNG/JPEG where WebP encoding is missing
  for (const q of [0.9, 0.8, 0.7, 0.6, 0.5]) {
    let type = "image/webp";
    let blob = await new Promise(r => canvas.toBlob(r, type, q));
    if (!blob || blob.type !== type) {
      type = transparent ? "image/png" : "image/jpeg";
      blob = await new Promise(r => canvas.toBlob(r, type, q));
    }
    if (blob.size <= maxBytes || q === 0.5) {
      return { blob, type, transparent, url: URL.createObjectURL(blob) };
    }
  }
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
