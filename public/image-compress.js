// Shrinks an image in the browser before it's uploaded: caps the longest
// side at 1600px and re-encodes as WebP at quality 0.8 — the same settings
// the old server used with sharp (which can't run on Cloudflare Workers).
// Never enlarges, and falls back to the original file if anything fails or
// the result isn't actually smaller, so an upload is never blocked by this.
window.compressImageFile = async function compressImageFile(file, maxSide = 1600, quality = 0.8) {
  try {
    if (!file || !file.type || !file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;

    let source;
    if (window.createImageBitmap) {
      source = await createImageBitmap(file);
    } else {
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
    }
    const w = source.width, h = source.height;
    if (!w || !h) return file;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    if (source.close) source.close();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
    // Some older Safari versions ignore 'image/webp' and return PNG — keep the original then.
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;

    const name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.webp';
    return new File([blob], name, { type: 'image/webp' });
  } catch (err) {
    console.warn('Image compression skipped:', err);
    return file;
  }
};
