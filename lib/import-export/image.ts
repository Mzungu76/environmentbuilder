import type { ImageAssetMeta } from '@/types';
import { uid } from '@/lib/ids';

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 80 * 1024 * 1024;

/** Validates an image file and reads its real pixel dimensions. Throws user-readable errors. */
export async function readImageFile(file: File): Promise<{ meta: ImageAssetMeta; blob: Blob }> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) throw new Error(`“${file.name}” non è supportato. Usa PNG, JPG o WebP.`);
  if (file.size > MAX_BYTES) throw new Error(`“${file.name}” è troppo grande (max 80 MB).`);
  const url = URL.createObjectURL(file);
  try {
    const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error(`“${file.name}” non è un’immagine valida.`));
      img.src = url;
    });
    if (!dims.w || !dims.h) throw new Error(`“${file.name}” ha dimensioni non valide.`);
    return { blob: file, meta: { id: uid('asset'), fileName: file.name, mime: file.type, width: dims.w, height: dims.h, bytes: file.size } };
  } finally {
    URL.revokeObjectURL(url);
  }
}
