import { PDFDocument } from "pdf-lib";

// Commercial lease PDFs are often 20-30MB with many appended parts (annexes,
// scanned signatures, ID copies). The contract TERMS live in the first pages,
// so we keep only the first `maxPages` — this shrinks the payload below the
// document-API limit, cuts cost, and speeds up extraction, with no action from
// the user. Returns the (possibly) trimmed buffer + page counts for the UI.
export async function truncatePdf(
  buf: Buffer,
  maxPages = 40
): Promise<{ buffer: Buffer; totalPages: number; keptPages: number; truncated: boolean }> {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
  const total = src.getPageCount();
  if (total <= maxPages) return { buffer: buf, totalPages: total, keptPages: total, truncated: false };

  const out = await PDFDocument.create();
  const idxs = Array.from({ length: maxPages }, (_, i) => i);
  const pages = await out.copyPages(src, idxs);
  pages.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  return { buffer: Buffer.from(bytes), totalPages: total, keptPages: maxPages, truncated: true };
}
