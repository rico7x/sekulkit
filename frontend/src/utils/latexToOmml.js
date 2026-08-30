import temml from 'temml'
import * as mathml2ommlNS from 'mathml2omml'
import { ImportedXmlComponent } from 'docx'

const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

// Tangani named export (mml2omml) maupun default export.
const mml2omml =
  typeof mathml2ommlNS.mml2omml === 'function' ? mathml2ommlNS.mml2omml
  : typeof mathml2ommlNS.default === 'function' ? mathml2ommlNS.default
  : typeof mathml2ommlNS === 'function' ? mathml2ommlNS
  : null

/**
 * Bangun ImportedXmlComponent dari sebuah DOM Element (rekursif).
 * Setara `convertToXmlComponent` internal docx, tapi kita mulai dari
 * elemen <m:oMath> yang sebenarnya — bukan root dokumen (yang tak bernama
 * dan menghasilkan wrapper <undefined> yang ditolak Word).
 */
function domToXmlComponent(node) {
  const attrs = {}
  for (const a of Array.from(node.attributes || [])) attrs[a.name] = a.value
  const comp = new ImportedXmlComponent(node.tagName, Object.keys(attrs).length ? attrs : undefined)
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 1) {          // element
      comp.push(domToXmlComponent(child))
    } else if (child.nodeType === 3) {   // text
      if (child.textContent) comp.push(child.textContent)
    }
  }
  return comp
}

/**
 * LaTeX -> elemen docx (ImportedXmlComponent membungkus <m:oMath>), atau null bila gagal.
 * Aman dipakai sebagai child Paragraph, sama slot dengan TextRun.
 */
export function latexToOmmlElement(latex, display = false) {
  try {
    if (!mml2omml) return null
    const mathml = temml.renderToString(latex, {
      displayMode: display,
      throwOnError: false,
      annotate: false, // jangan sertakan anotasi LaTeX di MathML
    })
    let omml = mml2omml(mathml)
    if (!omml || omml.indexOf('<m:oMath') === -1) return null
    if (omml.indexOf('xmlns:m=') === -1) {
      omml = omml.replace('<m:oMath', `<m:oMath xmlns:m="${M_NS}"`)
    }
    const dom = new DOMParser().parseFromString(omml, 'application/xml')
    if (dom.getElementsByTagName('parsererror').length) return null
    const root = dom.documentElement // <m:oMath>
    if (!root || root.tagName !== 'm:oMath') return null
    return domToXmlComponent(root)
  } catch (e) {
    console.warn('OMML convert gagal:', latex, e)
    return null
  }
}

/**
 * Pisah teks -> segmen {type:'text'|'math'}.
 * Delimiter utama: \( ... \) inline dan \[ ... \] blok (bebas bentrok simbol dolar).
 * $ / $$ tetap didukung sebagai fallback untuk soal lama.
 * Tolak kandidat $ tunggal yang isinya kosong/whitespace-edged/angka-saja (mis. "$5")
 * dan hormati escape "\$".
 */
export function tokenizeMath(text) {
  const tokens = []
  let i = 0
  let buf = ''
  const pushText = () => { if (buf) { tokens.push({ type: 'text', value: buf }); buf = '' } }
  while (i < text.length) {
    const c = text[i]
    // escape \$ → dolar literal (legacy)
    if (c === '\\' && text[i + 1] === '$') { buf += '$'; i += 2; continue }
    // \( ... \) inline
    if (c === '\\' && text[i + 1] === '(') {
      const end = text.indexOf('\\)', i + 2)
      if (end !== -1) {
        const inner = text.slice(i + 2, end)
        if (inner.trim().length > 0) {
          pushText()
          tokens.push({ type: 'math', latex: inner, display: false })
          i = end + 2
          continue
        }
      }
    }
    // \[ ... \] blok
    if (c === '\\' && text[i + 1] === '[') {
      const end = text.indexOf('\\]', i + 2)
      if (end !== -1) {
        const inner = text.slice(i + 2, end)
        if (inner.trim().length > 0) {
          pushText()
          tokens.push({ type: 'math', latex: inner, display: true })
          i = end + 2
          continue
        }
      }
    }
    if (c === '$') {
      const display = text[i + 1] === '$'
      const delim = display ? '$$' : '$'
      const end = text.indexOf(delim, i + delim.length)
      if (end !== -1) {
        const inner = text.slice(i + delim.length, end)
        const valid = inner.trim().length > 0 &&
          !(!display && (/^\s|\s$/.test(inner) || /^[\d.,]+$/.test(inner)))
        if (valid) {
          pushText()
          tokens.push({ type: 'math', latex: inner, display })
          i = end + delim.length
          continue
        }
      }
    }
    buf += c
    i++
  }
  pushText()
  return tokens
}
