import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-api-auth";
import Anthropic from "@anthropic-ai/sdk";
import { EXTRACT_PROMPT } from "@/lib/extract-prompt";

const PROMPT = EXTRACT_PROMPT;

export async function POST(req: NextRequest) {
  try {
    if (!(await requireUser(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const body = await req.json();
    const { text, images } = body;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }
    const client = new Anthropic({ apiKey });

    let content: any[];

    if (images && Array.isArray(images) && images.length > 0) {
      // OCR mode: send page images to Claude Vision. The client sends JPEG
      // (much smaller than PNG — PNG page scans blew past the request-body
      // limit and produced a 413).
      const mediaType = (body.mediaType === "image/png") ? "image/png" : "image/jpeg";
      content = [
        { type: "text", text: PROMPT + `\n\nלהלן ${images.length} עמודים ראשונים מהחוזה הסרוק:` },
      ];
      for (const img of images.slice(0, 12)) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: img },
        });
      }
    } else if (text) {
      // Text mode: send extracted text. 60K chars covers the whole body of a
      // long lease (20K cut off the guarantee/insurance annexes entirely).
      content = [{
        type: "text",
        text: PROMPT + `\n\nטקסט החוזה (${Math.round(text.length / 1000)}K תווים):\n${text.substring(0, 60000)}`,
      }];
    } else {
      return NextResponse.json({ error: "No text or images provided" }, { status: 400 });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      // The extraction schema grew (tiers, options, guarantors, insurance
      // requirements…) — 4096 truncated the JSON mid-object, which surfaced as
      // a parse failure / API error 500.
      max_tokens: 8192,
      messages: [{ role: "user", content }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const clean = raw.replace(/```json|```/g, "").trim();

    let data;
    try {
      data = JSON.parse(clean);
    } catch (e) {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) data = JSON.parse(match[0]);
      else throw new Error("לא ניתן לפרס JSON: " + clean.substring(0, 200));
    }

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
