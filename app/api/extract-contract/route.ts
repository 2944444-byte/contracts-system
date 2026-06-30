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
      // OCR mode: send page images to Claude Vision
      content = [
        { type: "text", text: PROMPT + `\n\nלהלן ${images.length} עמודים ראשונים מהחוזה הסרוק:` },
      ];
      for (const img of images.slice(0, 10)) { // max 10 pages
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: img,
          },
        });
      }
    } else if (text) {
      // Text mode: send extracted text
      content = [{
        type: "text",
        text: PROMPT + `\n\nטקסט החוזה (${Math.round(text.length / 1000)}K תווים):\n${text.substring(0, 20000)}`,
      }];
    } else {
      return NextResponse.json({ error: "No text or images provided" }, { status: 400 });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
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
