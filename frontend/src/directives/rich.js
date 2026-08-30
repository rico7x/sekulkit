import renderMathInElement from 'katex/contrib/auto-render'
import { markdownTableToHtml } from '../utils/markdownTable.js'

// Delimiter resmi: \( ... \) inline dan \[ ... \] blok — bebas bentrok simbol dolar.
const OPTS = {
  delimiters: [
    { left: '\\[', right: '\\]', display: true },
    { left: '\\(', right: '\\)', display: false },
  ],
  throwOnError: false,
  errorColor: '#dc2626',
  ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
}

/**
 * Migrasi soal lama: ubah pasangan $...$ / $$...$$ pada text node menjadi
 * \(...\) / \[...\] agar tetap ter-render dengan delimiter baru.
 * Heuristik (sama dengan tokenizer export): tolak pasangan yang kosong,
 * diapit whitespace, atau isinya angka saja — agar "$5 dan $7" tidak
 * ikut terkonversi menjadi rumus.
 */
function convertLegacyDollarDelimiters(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) nodes.push(walker.currentNode)

  for (const node of nodes) {
    const text = node.textContent
    if (!text || !text.includes('$')) continue

    let out = ''
    let i = 0
    let changed = false
    while (i < text.length) {
      const c = text[i]
      if (c === '\\' && text[i + 1] === '$') { out += '$'; i += 2; continue } // \$ = dolar literal
      if (c === '$') {
        const display = text[i + 1] === '$'
        const delim = display ? '$$' : '$'
        const end = text.indexOf(delim, i + delim.length)
        if (end !== -1) {
          const inner = text.slice(i + delim.length, end)
          const valid = inner.trim().length > 0 &&
            !(!display && (/^\s|\s$/.test(inner) || /^[\d.,]+$/.test(inner)))
          if (valid) {
            out += display ? `\\[${inner}\\]` : `\\(${inner}\\)`
            i = end + delim.length
            changed = true
            continue
          }
        }
      }
      out += c
      i++
    }
    if (changed) node.textContent = out
  }
}

function apply(el, html) {
  // Tabel markdown (dari LLM / soal lama) dikonversi ke <table> asli sebelum render
  el.innerHTML = markdownTableToHtml(html ?? '')
  convertLegacyDollarDelimiters(el)
  try { renderMathInElement(el, OPTS) } catch (e) { /* abaikan */ }
}

// Pengganti v-html yang sekaligus me-render KaTeX. Perilaku innerHTML identik v-html.
export const richDirective = {
  mounted(el, binding) { apply(el, binding.value) },
  updated(el, binding) { if (binding.value !== binding.oldValue) apply(el, binding.value) },
}
