
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();

    const message = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: `אתה מומחה לניתוח חוזי שכירות מסחריים בישראל.
חלץ את כל הנתונים הבאים מהחוזה והחזר JSON בלבד, ללא שום טקסט נוסף, ללא backticks, ללא הסברים.

שדות לחילוץ:

פרטי שוכר:
- tenant_name: שם השוכר המלא או שם החברה השוכרת
- tenant_id_number: מספר ח.פ. / ת.ז. של השוכר (null אם אין)
- tenant_phone: טלפון השוכר (null אם אין)
- tenant_email: אימייל השוכר (null אם אין)
- tenant_address: כתובת השוכר (null אם אין)
- tenant_contact_name: שם איש קשר של השוכר (null אם אין)
- tenant_contact_phone: טלפון איש קשר (null אם אין)

פרטי נכס ויחידה:
- property_name: שם הנכס או הבניין (null אם אין)
- property_address: כתובת הנכס (null אם אין)
- unit_name: שם/מספר היחידה המושכרת (null אם אין)

פרטי חוזה:
- start_date: תאריך תחילת השכירות בפורמט YYYY-MM-DD
- end_date: תאריך סיום השכירות בפורמט YYYY-MM-DD
- duration_months: מספר חודשי השכירות (מספר שלם)
- rent_per_sqm: דמי שכירות לכל מטר רבוע לחודש (מספר בלבד, בשקלים)
- charged_area: שטח מחויב במטרים רבועים (מספר בלבד)
- investment_addition: תוספת השקעות או תוספת מיוחדת לשכ"ד (מספר בלבד, 0 אם אין)
- option_months: מספר חודשי האופציה (מספר שלם, null אם אין)
- option_deadline: מועד אחרון להודעה על מימוש אופציה בפורמט YYYY-MM-DD (null אם אין)
- guarantee_type: סוג הערבות - החזר אחד מ: bank/check/cash/other (null אם אין)
- guarantee_amount: סכום הערבות בשקלים (מספר בלבד, null אם אין)
- guarantee_expiry: תאריך פקיעת הערבות בפורמט YYYY-MM-DD (null אם אין)
- index_base_date: חודש מדד הבסיס בפורמט YYYY-MM (null אם אין)
- index_base_value: ערך מדד הבסיס (מספר עשרוני, null אם אין)
- payment_frequency: תדירות תשלום - החזר אחד מ: monthly/quarterly/other
- parking_spots: מספר חניות (null אם אין)
- parking_monthly_fee: דמי חניה חודשיים (null אם אין)

הנחיות חשובות:
1. אם לא מצאת שדה — החזר null
2. תאריכים חייבים להיות בפורמט YYYY-MM-DD בלבד
3. סכומים כספיים — מספרים בלבד ללא סימני מטבע
4. אם הדיירת היא חברה — החזר את שם החברה המלא
5. חפש פרטי שוכר בכל מקום בחוזה — כולל כותרת, צדדים להסכם, נספחים

טקסט החוזה (${Math.round(text.length/1000)}K תווים):
${text.substring(0, 20000)}`
      }]
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const clean = raw.replace(/```json|```/g, "").trim();
    
    let data;
    try {
      data = JSON.parse(clean);
    } catch(e) {
      // נסה לחלץ JSON מתוך הטקסט
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) data = JSON.parse(match[0]);
      else throw new Error("לא ניתן לפרס JSON: " + clean.substring(0, 200));
    }
    
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
