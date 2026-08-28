import { Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType } from 'docx'
import { tokenizeMath, latexToOmmlElement } from './latexToOmml.js'

/**
 * Fetch image URL → ArrayBuffer
 */
function resolveImageUrl(src) {
  return src.startsWith('/') ? window.location.origin + src : src
}

async function fetchImageAsBuffer(url) {
  const fullUrl = resolveImageUrl(url)
  const res = await fetch(fullUrl)
  if (!res.ok) throw new Error(`Gagal fetch gambar: ${url}`)
  return await res.arrayBuffer()
}

/**
 * Ambil dimensi asli gambar (untuk rasio aspek di DOCX).
 * Balikin null kalau gagal — pemanggil pakai default.
 */
function getImageSize(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * Gabungkan HTML pertanyaan dengan gambar ilustrasi soal (jika ada),
 * supaya gambar ikut terbawa di preview print & semua exporter DOCX.
 */
export function withSoalImage(soal) {
  if (!soal?.image_url) return soal?.pertanyaan || ''
  return `${soal.pertanyaan || ''}<p><img src="${soal.image_url}" class="soal-image" /></p>`
}

/**
 * Detect image MIME type from buffer
 */
function getMimeType(buffer) {
  const bytes = new Uint8Array(buffer.slice(0, 4))
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif'
  return 'image/png'
}

/**
 * Convert data URI → ArrayBuffer
 */
function dataUriToBuffer(dataUri) {
  const base64 = dataUri.split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/**
 * Parse inline HTML node → array of TextRun / ImageRun
 * Handles: text, <strong>, <em>, <u>, <s>, <code>, <img>, <br>
 */
async function inlineToRuns(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent
    if (!text) return []
    const toks = tokenizeMath(text)
    if (toks.length === 1 && toks[0].type === 'text') return [new TextRun({ text })]
    const out = []
    for (const t of toks) {
      if (t.type === 'text') {
        if (t.value) out.push(new TextRun({ text: t.value }))
      } else {
        const el = latexToOmmlElement(t.latex, t.display)
        const d = t.display ? '$$' : '$'
        out.push(el || new TextRun({ text: d + t.latex + d })) // fallback teks bila gagal
      }
    }
    return out
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return []

  const tag = node.tagName

  // Image → ImageRun (rasio aspek dipertahankan, max 320×320)
  if (tag === 'IMG') {
    const src = node.getAttribute('src')
    if (!src) return []
    try {
      let buffer
      if (src.startsWith('data:')) {
        buffer = dataUriToBuffer(src)
      } else {
        buffer = await fetchImageAsBuffer(src)
      }
      const mimeType = getMimeType(buffer)
      let width = 320, height = 240
      const dims = await getImageSize(resolveImageUrl(src))
      if (dims?.width > 0 && dims?.height > 0) {
        const scale = Math.min(320 / dims.width, 320 / dims.height, 1)
        width = Math.max(1, Math.round(dims.width * scale))
        height = Math.max(1, Math.round(dims.height * scale))
      }
      return [new ImageRun({
        data: buffer,
        transformation: { width, height },
        type: mimeType
      })]
    } catch (err) {
      console.warn('Gagal embed gambar ke DOCX:', src, err)
      return [new TextRun({ text: `[Gambar: ${src}]`, italics: true, color: '999999' })]
    }
  }

  // Line break
  if (tag === 'BR') {
    return [new TextRun({ break: 1 })]
  }

  // Recurse children with formatting
  const runs = []
  for (const child of node.childNodes) {
    const childRuns = await inlineToRuns(child)
    // Apply formatting
    if (tag === 'STRONG' || tag === 'B') childRuns.forEach(r => { if (r instanceof TextRun) r.root[1].bold = true })
    if (tag === 'EM' || tag === 'I') childRuns.forEach(r => { if (r instanceof TextRun) r.root[1].italics = true })
    if (tag === 'U') childRuns.forEach(r => { if (r instanceof TextRun) r.root[1].underline = {} })
    if (tag === 'S' || tag === 'STRIKE') childRuns.forEach(r => { if (r instanceof TextRun) r.root[1].strike = true })
    if (tag === 'CODE') childRuns.forEach(r => { if (r instanceof TextRun) r.root[1].font = { name: 'Consolas' } })
    runs.push(...childRuns)
  }
  return runs
}

/**
 * Convert block HTML element → array of { runs, options }
 * Returns plain objects instead of Paragraph instances for easier merging
 */
async function blockToStructures(el) {
  const tag = el.tagName

  // Heading
  if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) {
    const level = parseInt(tag[1])
    const headingMap = {
      1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2,
      3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4,
      5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6
    }
    return [{ runs: await inlineToRuns(el), options: { heading: headingMap[level] || HeadingLevel.HEADING_4 } }]
  }

  // Paragraph
  if (tag === 'P') {
    return [{ runs: await inlineToRuns(el), options: {} }]
  }

  // Horizontal rule
  if (tag === 'HR') {
    return [{ runs: [new TextRun({ text: '─'.repeat(60), color: 'CCCCCC' })], options: { alignment: AlignmentType.CENTER } }]
  }

  // Bullet list
  if (tag === 'UL') {
    const items = []
    for (const li of el.children) {
      if (li.tagName === 'LI') {
        const runs = await inlineToRuns(li)
        items.push({ runs: [new TextRun({ text: '• ' }), ...runs], options: { indent: { left: 360 } } })
      }
    }
    return items
  }

  // Ordered list
  if (tag === 'OL') {
    const items = []
    let num = 1
    for (const li of el.children) {
      if (li.tagName === 'LI') {
        const runs = await inlineToRuns(li)
        items.push({ runs: [new TextRun({ text: `${num}. ` }), ...runs], options: { indent: { left: 360 } } })
        num++
      }
    }
    return items
  }

  // Blockquote
  if (tag === 'BLOCKQUOTE') {
    const runs = await inlineToRuns(el)
    return [{ runs: [new TextRun({ text: '│ ', color: '999999' }), ...runs], options: { indent: { left: 360 } } }]
  }

  // Pre/code block
  if (tag === 'PRE') {
    const text = el.textContent
    return [{ runs: [new TextRun({ text, font: { name: 'Consolas' }, size: 18 })], options: { indent: { left: 360 } } }]
  }

  // Recurse — proses text node lewat inlineToRuns agar tokenizeMath aktif
  const items = []
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const runs = await inlineToRuns(child)
      if (runs.length > 0) items.push({ runs, options: {} })
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      items.push(...await blockToStructures(child))
    }
  }
  return items
}

/**
 * Convert HTML string → array of { runs, options } structures
 * Use with buildDocxParagraphs() to create final Paragraph objects
 */
export async function htmlToDocxStructures(html) {
  if (!html) return []

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const body = doc.body

  const structures = []
  for (const child of body.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      // Proses lewat inlineToRuns agar tokenizeMath bisa mendeteksi $...$
      const runs = await inlineToRuns(child)
      if (runs.length > 0) structures.push({ runs, options: {} })
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      structures.push(...await blockToStructures(child))
    }
  }
  return structures
}

/**
 * Build Paragraph array from structures, with optional indent override
 * @param {Array} structures - from htmlToDocxStructures
 * @param {object} overrideOptions - e.g. { indent: { left: 360 } }
 */
export function buildDocxParagraphs(structures, overrideOptions = {}) {
  return structures.map(s => new Paragraph({
    children: s.runs,
    ...s.options,
    ...overrideOptions
  }))
}

/**
 * Convert HTML → plain text
 */
export function htmlToPlainText(html) {
  if (!html) return ''
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  return doc.body.textContent || ''
}
