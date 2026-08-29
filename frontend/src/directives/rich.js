import renderMathInElement from 'katex/contrib/auto-render'
import { markdownTableToHtml } from '../utils/markdownTable.js'

const OPTS = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\(', right: '\\)', display: false },
    { left: '\\[', right: '\\]', display: true },
  ],
  throwOnError: false,
  errorColor: '#dc2626',
  ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
}

function apply(el, html) {
  // Tabel markdown (dari LLM / soal lama) dikonversi ke <table> asli sebelum render
  el.innerHTML = markdownTableToHtml(html ?? '')
  try { renderMathInElement(el, OPTS) } catch (e) { /* abaikan */ }
}

// Pengganti v-html yang sekaligus me-render KaTeX. Perilaku innerHTML identik v-html.
export const richDirective = {
  mounted(el, binding) { apply(el, binding.value) },
  updated(el, binding) { if (binding.value !== binding.oldValue) apply(el, binding.value) },
}
