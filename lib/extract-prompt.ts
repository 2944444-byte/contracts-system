// Shared extraction prompt for contract documents. Used by both the
// /api/extract-contract route (client supplies extracted text / page images)
// and /api/extract-from-url route (server fetches a document by URL and lets
// Claude read it natively).
export const EXTRACT_PROMPT = `אתה מומחה לניתוח חוזי שכירות מסחריים בישראל.
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
- investment_addition: תוספת השקעות בינוי לשכ"ד החודשי (מספר בלבד, 0 אם אין)
- investment_amount: סכום ההשקעה הכולל שהמשכיר משקיע/מחזיר לשוכר עבור עבודות בינוי והתאמה (מספר בלבד, null אם אין)
- investment_description: תיאור עבודות ההשקעה/ההתאמה (null אם אין)
- investment_payment_trigger: מתי משולם החזר ההשקעה לשוכר - החזר אחד מ: on_completion (עם השלמת העבודות) / on_opening (עם פתיחת העסק) / on_handover (במסירת המושכר) / fixed_date (בתאריך קבוע) / installments (בתשלומים). null אם לא צוין
- investment_payment_days: מספר הימים ממועד ההפעלה ועד תשלום ההחזר (מספר שלם, null אם אין)
- investment_requires_invoice: true אם ההחזר מותנה בהמצאת חשבונית (בררת מחדל true)
- investment_requires_report: true אם ההחזר מותנה בהמצאת דו"ח עבודות/אישור מוסדר (בררת מחדל true)
- option_months: מספר חודשי האופציה (מספר שלם, null אם אין)
- option_deadline: מועד אחרון להודעה על מימוש אופציה בפורמט YYYY-MM-DD (null אם אין)
- index_base_date: חודש מדד הבסיס בפורמט YYYY-MM (null אם אין)
- index_base_value: ערך מדד הבסיס (מספר עשרוני, null אם אין)
- payment_frequency: תדירות תשלום - החזר אחד מ: monthly/quarterly/other
- parking_spots: מספר חניות (null אם אין)
- parking_monthly_fee: דמי חניה חודשיים לחניה בודדת (null אם אין)
- mgmt_fee_per_sqm: דמי ניהול למ"ר לחודש (מספר בלבד, null אם אין)
- vat_type: החזר אחד מ: plus_vat (שכ"ד בתוספת מע"מ) / included (כולל מע"מ) / exempt (פטור ממע"מ). null אם לא צוין
- rent_type: סוג שכ"ד - החזר אחד מ: fixed (סכום קבוע) / per_sqm (לפי מ"ר) / revenue (אחוז מפדיון/מחזור). null אם לא ברור
- revenue_pct: אחוז מהפדיון/מחזור (רק בחוזי פדיון, מספר בלבד, null אם אין)
- min_rent_per_sqm: שכ"ד מינימלי למ"ר (בחוזי פדיון, null אם אין)
- indexation_method: שיטת הצמדה למדד - החזר אחד מ: none (ללא הצמדה) / regular (הצמדה רגילה) / highest_in_period (המדד הגבוה בתקופה) / no_drop (הצמדה ללא ירידה). null אם לא צוין
- grace_months: חודשי גרייס / דחיית תשלום מתחילת השכירות (מספר שלם, null אם אין)
- grace_type: החזר אחד מ: no_charge (ללא חיוב בתקופת הגרייס) / discount (הנחה). null אם אין גרייס
- rent_steps: מערך מדרגות עליית שכ"ד לאורך התקופה (אם החוזה קובע עליות מדורגות). כל איבר: {"effective_date":"YYYY-MM-DD","rent_per_sqm":מספר או "amount":מספר}. [] אם אין מדרגות

ערבות / בטוחה (בחוזים רבים יש כמה בטוחות יחד — למשל ערבות בנקאית וגם שטר חוב):
- guarantee_type: סוג הבטוחה **העיקרית** - החזר אחד מ: bank (ערבות בנקאית) / cash (פיקדון/מזומן) / promissory_note (שטר חוב) / check (שיקים) / personal (ערבות אישית) / other (null אם אין)
- guarantee_amount: סכום הבטוחה העיקרית בשקלים (מספר בלבד, null אם אין)
- guarantee_months: לכמה חודשי שכירות שווה הערבות אם מצוין (מספר שלם, null אם אין)
- guarantee_expiry: תאריך פקיעת הערבות בפורמט YYYY-MM-DD (null אם אין; לשטר חוב לרוב אין תוקף)
- guarantee_bank: שם הבנק שהוציא את הערבות הבנקאית (null אם אין)
- additional_guarantee_types: מערך סוגי בטוחות **נוספות** מלבד העיקרית (כל איבר אחד מ: bank/cash/promissory_note/check/personal/other). [] אם אין נוספות
- guarantors: מערך ערבים (בעיקר לשטר חוב / ערבות אישית). כל איבר: {"name":"שם","id_number":"ת.ז."}. [] אם אין

אופציות להארכה:
- options: מערך אופציות להארכה. כל איבר: {"duration_months":מספר,"notice_type":"exercise" (דרושה הודעת מימוש) או "non_exercise" (דרושה הודעת אי-מימוש),"notice_days_before_end":מספר ימי הודעה לפני תום התקופה}. [] אם אין אופציות

דרישות ביטוח של השוכר (מתוך נספח האחריות והביטוח / סעיף "ביטוחי השוכרת"):
- insurance_requirements: אובייקט JSON הממפה את סוגי הכיסוי הנדרשים מהשוכר לגבול האחריות / סכום הביטוח המינימלי בשקלים.
  המפתחות האפשריים (כלול רק את אלו שנדרשים בפועל בחוזה):
    - contents: ביטוח תכולה / רכוש השוכר
    - third_party: ביטוח אחריות כלפי צד שלישי (חפש "גבול אחריות בסך של ..." — לרוב 10,000,000)
    - employers: ביטוח חבות מעבידים (חפש גבול אחריות — לרוב סביב 20,000,000)
    - consequential: ביטוח אבדן תוצאתי
    - contractor: ביטוח עבודות קבלניות
  הערך לכל מפתח = גבול האחריות המינימלי במספרים בלבד (ללא פסיקים/מטבע). אם הכיסוי נדרש אך לא צוין סכום — החזר 0.
  אם לא נדרש כיסוי מסוים — אל תכלול את המפתח כלל. אם אין נספח ביטוח בכלל — החזר אובייקט ריק {}.

הנחיות חשובות:
1. אם לא מצאת שדה — החזר null (או {} עבור insurance_requirements)
2. תאריכים חייבים להיות בפורמט YYYY-MM-DD בלבד
3. סכומים כספיים — מספרים בלבד ללא סימני מטבע ופסיקים
4. אם הדיירת היא חברה — החזר את שם החברה המלא
5. חפש פרטי שוכר בכל מקום בחוזה — כולל כותרת, צדדים להסכם, נספחים`;
