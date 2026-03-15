// ייצוא PDF מהדפדפן — משתמש ב-window.print עם CSS מותאם
// אין צורך בספרייה חיצונית — print dialog עם print-specific CSS

export function printLetter(elementId: string, filename?: string) {
  const el = document.getElementById(elementId);
  if (!el) { alert("אין תוכן להדפסה"); return; }

  const printWindow = window.open("", "_blank");
  if (!printWindow) { alert("הדפדפן חסם פתיחת חלון — אפשר popup"); return; }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html dir="rtl" lang="he">
    <head>
      <meta charset="UTF-8">
      <title>${filename ?? "מכתב"}</title>
      <style>
        * { box-sizing: border-box; }
        body {
          font-family: 'Arial', 'Helvetica', sans-serif;
          font-size: 12pt;
          line-height: 1.6;
          color: #000;
          margin: 0;
          padding: 20mm 25mm;
          direction: rtl;
          text-align: right;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 12pt 0;
          font-size: 10pt;
        }
        th, td {
          border: 1px solid #999;
          padding: 5pt 8pt;
          text-align: right;
        }
        th { background: #333; color: #fff; font-weight: bold; }
        tr:nth-child(even) { background: #f5f5f5; }
        tfoot td { background: #1e3a5f; color: #fff; font-weight: bold; }
        h1, h2, h3 { color: #1e3a5f; }
        .no-print { display: none !important; }
        @page {
          size: A4;
          margin: 20mm 25mm;
        }
        @media print {
          body { padding: 0; }
        }
      </style>
    </head>
    <body>
      ${el.innerHTML}
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(function() {
    printWindow.print();
    printWindow.close();
  }, 500);
}

export function downloadLetterAsHtml(elementId: string, filename: string) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"><title>${filename}</title></head><body style="font-family:Arial;padding:20mm 25mm;direction:rtl">${el.innerHTML}</body></html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename + ".html"; a.click();
  URL.revokeObjectURL(url);
}
