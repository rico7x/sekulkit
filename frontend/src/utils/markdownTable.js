// =====================
// Konversi markdown table → HTML <table> (versi browser)
// Soal lama yang tersimpan dengan tabel markdown tetap tampil benar
// tanpa perlu migrasi database — dikonversi saat render (v-rich).
// =====================

function convertCell(s) {
  let c = s.trim();
  c = c.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return c;
}

function parseRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(convertCell);
}

function parseAlignments(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => {
    const t = c.trim();
    if (t.startsWith(':') && t.endsWith(':')) return 'center';
    if (t.endsWith(':')) return 'right';
    return 'left';
  });
}

const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSepRow = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);

export function markdownTableToHtml(html) {
  if (!html) return html;

  const lines = String(html).split(/\r?\n/);
  const out = [];
  let i = 0;

  while (i < lines.length) {
    if (isTableRow(lines[i]) && i + 1 < lines.length && isSepRow(lines[i + 1])) {
      const header = parseRow(lines[i]);
      const aligns = parseAlignments(lines[i + 1]);
      const alignStyle = (idx) => (aligns[idx] && aligns[idx] !== 'left' ? ` style="text-align:${aligns[idx]}"` : '');

      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(parseRow(lines[i]));
        i++;
      }

      let t = '<table class="soal-table"><thead><tr>'
        + header.map((h, idx) => `<th${alignStyle(idx)}>${h}</th>`).join('')
        + '</tr></thead><tbody>';
      for (const r of rows) {
        t += '<tr>' + r.map((c, idx) => `<td${alignStyle(idx)}>${c}</td>`).join('') + '</tr>';
      }
      t += '</tbody></table>';
      out.push(t);
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join('\n');
}
