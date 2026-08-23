import 'server-only';

// Image uploads land in the PUBLIC `gym-assets` bucket and are served straight
// off the CDN, so the browser renders whatever content type the object was
// stored with. Every upload path used to pass `contentType: file.type`
// verbatim — a client-supplied string — and gate on at most
// `file.type.startsWith('image/')`, which happily admits `image/svg+xml`.
//
// An SVG is a script host: a manager (or anyone who reaches an upload form)
// could store `<svg><script>…</script></svg>`, get back a same-origin public
// URL, and run script in the browser of every staffer or member who opens it.
// Logos and avatars make that worse by embedding the URL on branded pages.
//
// So: allowlist the raster types we actually display, and derive both the
// stored content type and the file extension from the ALLOWLIST rather than
// from anything the client sent. A file whose bytes disagree with its declared
// type is then served as a broken image instead of as script.
const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const IMAGE_TYPE_ERROR = 'Image must be a PNG, JPEG, WebP or GIF.';

export type CheckedImage = { ok: true; contentType: string; ext: string } | { ok: false; error: string };

// Validate a client-supplied File and return the server-chosen content type
// and extension to store it under. Callers must use the returned values rather
// than `file.type` / the uploaded filename.
export function checkImage(file: File, maxBytes: number): CheckedImage {
  const ext = ALLOWED[file.type];
  if (!ext) return { ok: false, error: IMAGE_TYPE_ERROR };
  if (file.size > maxBytes) {
    return { ok: false, error: `Image must be under ${Math.floor(maxBytes / 1_000_000)} MB.` };
  }
  return { ok: true, contentType: file.type, ext };
}
