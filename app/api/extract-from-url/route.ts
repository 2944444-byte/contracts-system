import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-api-auth";
import Anthropic from "@anthropic-ai/sdk";
import { EXTRACT_PROMPT } from "@/lib/extract-prompt";
import { truncatePdf } from "@/lib/pdf-truncate";

export const runtime = "nodejs";
export const maxDuration = 60;

// Normalize common cloud-share links into direct-download URLs so we can fetch
// the raw bytes. Private/local files (not shared publicly) won't be reachable.
function normalizeUrl(url: string): string {
  let u = url.trim();
  // Dropbox: ?dl=0 → ?dl=1, and www.dropbox.com → dl.dropboxusercontent.com
  if (u.includes("dropbox.com")) {
    u = u.replace("www.dropbox.com", "dl.dropboxusercontent.com");
    if (u.includes("?dl=0")) u = u.replace("?dl=0", "?dl=1");
    else if (u.includes("&dl=0")) u = u.replace("&dl=0", "&dl=1");
    else if (!u.includes("dl=1")) u += (u.includes("?") ? "&" : "?") + "dl=1";
  }
  // Google Drive: /file/d/<id>/view → direct download
  const gd = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (gd) u = "https://drive.google.com/uc?export=download&id=" + gd[1];
  return u;
}

function parseJson(raw: string): any {
  const clean = raw.replace(/```json|```/g, "").trim();
  try { return JSON.parse(clean); }
  catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("לא ניתן לפרס JSON: " + clean.substring(0, 200));
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await requireUser(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { fileUrl } = await req.json();
    if (!fileUrl) return NextResponse.json({ error: "לא סופק קישור למסמך" }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

    const url = normalizeUrl(fileUrl);
    let res: Response;
    try {
      res = await fetch(url, { redirect: "follow" });
    } catch (e: any) {
      return NextResponse.json({ error: "לא ניתן להוריד את הקובץ מהקישור. ודא שהקישור ציבורי/משותף." }, { status: 400 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: "הורדת הקובץ נכשלה (" + res.status + "). ודא שהקישור ציבורי." }, { status: 400 });
    }

    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    const lower = url.toLowerCase();
    let buf: Buffer = Buffer.from(await res.arrayBuffer());
    // Allow large downloads (multi-part lease PDFs are commonly 20-30MB) — we
    // trim them to the first pages below, so the payload sent onward stays small.
    if (buf.length > 60 * 1024 * 1024) {
      return NextResponse.json({ error: "הקובץ גדול מדי (מעל 60MB)." }, { status: 400 });
    }

    const client = new Anthropic({ apiKey });
    let content: any[];
    let truncNote: { totalPages: number; keptPages: number; truncated: boolean } | null = null;

    const isPdf  = ctype.includes("pdf") || lower.includes(".pdf");
    const isDocx = ctype.includes("word") || ctype.includes("officedocument") || lower.includes(".docx");

    if (isPdf) {
      // Auto-trim to the first 40 pages (contract terms) — no user action needed.
      try {
        const t = await truncatePdf(buf, 40);
        buf = t.buffer;
        truncNote = { totalPages: t.totalPages, keptPages: t.keptPages, truncated: t.truncated };
      } catch (e) { /* corrupt/uncopyable → send original, size-checked below */ }
      if (buf.length > 30 * 1024 * 1024) {
        return NextResponse.json({ error: "המסמך גדול מדי לעיבוד גם לאחר חיתוך ל-40 עמודים. נסה להעלות רק את גוף החוזה." }, { status: 400 });
      }
      // Claude reads PDFs natively (text + scanned pages).
      content = [
        { type: "text", text: EXTRACT_PROMPT + "\n\nלהלן מסמך החוזה (PDF):" },
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } },
      ];
    } else if (isDocx) {
      // Extract text from DOCX with mammoth, then text mode.
      let text = "";
      try {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer: buf });
        text = result.value || "";
      } catch (e: any) {
        return NextResponse.json({ error: "כשל בקריאת קובץ ה-DOCX: " + (e?.message || e) }, { status: 400 });
      }
      if (!text.trim()) return NextResponse.json({ error: "לא נמצא טקסט בקובץ ה-DOCX." }, { status: 400 });
      content = [{ type: "text", text: EXTRACT_PROMPT + "\n\nטקסט החוזה:\n" + text.substring(0, 60000) }];
    } else {
      return NextResponse.json({ error: "סוג קובץ לא נתמך (נדרש PDF או DOCX). זוהה: " + (ctype || "לא ידוע") }, { status: 400 });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [{ role: "user", content }],
    });
    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const data = parseJson(raw);
    if (truncNote?.truncated) data._truncated = truncNote;
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
