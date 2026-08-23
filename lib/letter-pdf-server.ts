// יצירת PDF של מכתב בשרת — באותו מנוע של כפתור ההדפסה (Chromium), ולכן
// התוצאה זהה לקובץ שהמשתמש מקבל מ"שמור כ-PDF": עיצוב מלא, עמודי נספח
// לרוחב (‎@page‎ בשם), רווחים תקינים בעברית. מחליף את צילום ה-HTML
// (html2canvas) שבלע רווחים בעברית ואיבד את הסגנונות.
//
// גופנים: בשרת לינוקס אין "David"/"Arial". David Libre (הגרסה החופשית
// של David) ו-Arimo (תואם-מידות ל-Arial) מוטמעים ב-@font-face תחת
// השמות שהמכתב מבקש, כך שהמראה נשאר כמו בהדפסה מהמחשב.
import fs from "fs";
import path from "path";

const FONT_DIR = path.join(process.cwd(), "lib", "fonts");

function fontFace(family: string, file: string, weight: string): string {
  const p = path.join(FONT_DIR, file);
  if (!fs.existsSync(p)) return "";
  const b64 = fs.readFileSync(p).toString("base64");
  return "@font-face{font-family:\"" + family + "\";font-weight:" + weight + ";font-style:normal;" +
    "src:url(data:font/ttf;base64," + b64 + ") format(\"truetype\")}";
}

let fontCssCache: string | null = null;
function fontCss(): string {
  if (fontCssCache !== null) return fontCssCache;
  fontCssCache =
    fontFace("David", "DavidLibre-Regular.ttf", "normal") +
    fontFace("David", "DavidLibre-Bold.ttf", "bold") +
    // Arimo הוא גופן משתנה (100–900) — הצהרה אחת מכסה רגיל ומודגש.
    fontFace("Arial", "Arimo.ttf", "100 900");
  return fontCssCache;
}

async function launchBrowser(): Promise<any> {
  const puppeteer = (await import("puppeteer-core")).default;
  const onServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (onServerless) {
    const chromium = (await import("@sparticuz/chromium")).default;
    // ללא WebGL/GPU — מומלץ לסביבות שרת ומונע כשלי אתחול.
    chromium.setGraphicsMode = false;
    const exe = await chromium.executablePath();
    console.info("letter-pdf: chromium at", exe);
    return puppeteer.launch({
      args: chromium.args,
      executablePath: exe,
      headless: true,
    });
  }
  // פיתוח מקומי: Chrome המותקן במחשב.
  const candidates = [
    process.env.CHROME_PATH || "",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const exe = candidates.find(function (c) { return fs.existsSync(c); });
  if (!exe) throw new Error("לא נמצא Chrome מקומי (הגדר CHROME_PATH)");
  return puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox"] });
}

// html = מסמך המכתב המלא (buildLetterHtmlDoc) — הגופנים מוזרקים ל-<head>.
export async function renderLetterPdf(html: string): Promise<Buffer> {
  const withFonts = html.replace(/<head>/i, "<head><style>" + fontCss() + "</style>");
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(withFonts, { waitUntil: "networkidle0" });
    await page.evaluate("document.fonts && document.fonts.ready");
    const pdf: Uint8Array = await page.pdf({
      format: "a4",
      printBackground: true,
      // ‎@page‎ של המסמך קובע גודל, שוליים ואוריינטציה (נספח לרוחב).
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
