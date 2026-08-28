// =====================
// AI Image Generator
// Mendukung 2 gaya API:
// 1. OpenAI-compatible /images/generations (9router, proxy lokal, dsb.)
// 2. Chat completions dengan modalities image (OpenRouter: google/gemini-2.5-flash-image, dll.)
//
// Hasil gambar disimpan ke data/storage (folder yang sama dengan upload user)
// dan dicatat di tabel uploaded_files, sehingga bisa disajikan via /api/uploads/*
// =====================

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/init.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.join(__dirname, '../../data/storage');
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const TIMEOUT_MS = 120000;

// Style default saat prompt langsung dipakai tanpa refinement.
// Tidak melarang teks — diagram fisika/geometri justru butuh label ("Q", "4.0 cm").
const STYLE_SUFFIX =
  '. Style: clean, simple educational image for a school exam paper, plain white background, accurate proportions, no watermark, no signature.';

export function buildImagePrompt(imagePrompt) {
  const p = String(imagePrompt || '').trim();
  return p ? p + STYLE_SUFFIX : '';
}

/**
 * Parse respons chat/completions yang bisa berupa JSON biasa
 * ATAU SSE stream ("data: {...}" per baris) — beberapa proxy mem-streaming
 * respons walau stream:false diminta.
 * Balikin bentuk ternormalisasi: { choices: [{ message: { content, images } }] }
 */
async function parseCompletionResponse(res) {
  const contentType = res.headers.get('content-type') || ''

  if (contentType.includes('text/event-stream')) {
    const raw = await res.text()
    let content = ''
    const images = []
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        const choice = json?.choices?.[0]
        const piece = choice?.delta?.content ?? choice?.message?.content ?? ''
        if (typeof piece === 'string') content += piece
        else if (Array.isArray(piece)) content += piece.map(p => p?.text || '').join('')
        const pieceImages = choice?.delta?.images || choice?.message?.images
        if (Array.isArray(pieceImages)) images.push(...pieceImages)
      } catch {
        // chunk tidak valid — lewati
      }
    }
    const message = { content }
    if (images.length > 0) message.images = images
    return { choices: [{ message }] }
  }

  return await res.json()
}

/**
 * Refine prompt gambar via model TEKS sebelum dikirim ke image model.
 * Model teks menulis ulang deskripsi mentah menjadi prompt yang detail:
 * - Diagram teknis (fisika/geometri/grafik): tata letak presisi, proporsi, label persis, gaya line-art buku teks
 * - Ilustrasi (makhluk hidup/pemandangan/benda): detail visual, komposisi, gaya edukatif bersih
 *
 * ATURAN BAHASA: struktur prompt tetap bahasa Inggris (image model paling akurat),
 * TAPI semua teks/label yang dirender DI DALAM gambar wajib bahasa Indonesia
 * (ditulis verbatim di dalam prompt), supaya gambar konsisten dengan soal berbahasa Indonesia.
 */
export async function refineImagePrompt(rawPrompt, { model, baseUrl, apiKey, extraHeaders = {}, mataPelajaran = '', soalContext = '', labelLanguage = 'Indonesia' }) {
  const systemPrompt = `Kamu ahli menulis prompt untuk AI image generator dalam konteks soal ujian sekolah.
Ubah deskripsi gambar mentah di bawah menjadi SATU prompt yang detail dan terstruktur.

ATURAN BAHASA (PALING PENTING):
- Struktur kalimat prompt ditulis dalam bahasa Inggris agar image model paling akurat.
- TAPI semua teks/label yang muncul DI DALAM gambar WAJIB dalam bahasa ${labelLanguage}.
- Tulis setiap label VERBATIM dalam bahasa ${labelLanguage} di dalam prompt, contoh: the label "Ketinggian 4,0 cm", the label "Muatan A", the title "Skema Rangkaian Listrik".
- JANGAN PERNAH menerjemahkan label dalam gambar ke bahasa Inggris. Teks di dalam gambar = bahasa ${labelLanguage}.

CARA KERJA:
1. Analisis jenis gambar yang dibutuhkan soal:
   a) DIAGRAM TEKNIS (fisika, matematika, geometri, grafik fungsi, rangkaian listrik, vektor, bidang miring):
      - Deskripsikan tata letak secara eksplisit dan proporsional: posisi (kiri/kanan/atas/bawah/tengah), jarak relatif antar objek, perbandingan ukuran
      - Sebutkan semua label/teks yang harus muncul, TULIS VERBATIM dalam bahasa ${labelLanguage} (contoh: the label "Q", the label "3,0 cm", the label "Titik A")
      - Gaya: black-and-white textbook line diagram, thin clean lines, small clear readable labels, plain white background
   b) ILUSTRASI (makhluk hidup, pemandangan, benda, suasana):
      - Perkaya detail visual utama, komposisi, sudut pandang, elemen pendukung yang relevan dengan soal
      - Jika ada teks di dalam ilustrasi (misal tulisan pada papan, kartu, rambu), teksnya WAJIB bahasa ${labelLanguage} dan ditulis verbatim
      - Gaya: simple educational illustration, clean, not distracting, plain white background
2. Gunakan istilah yang SAMA dengan teks soal (lihat konteks soal di bawah) agar label gambar konsisten dengan pertanyaan.
3. SELALU akhiri dengan: no watermark, no signature.
4. Jangan menambahkan konsep yang tidak ada di deskripsi mentah maupun konteks soal.

OUTPUT: SATU paragraf prompt (struktur bahasa Inggris, semua label dalam gambar verbatim bahasa ${labelLanguage}), tanpa penjelasan, tanpa pembuka, tanpa tanda kutip pembungkus.${mataPelajaran ? `\n\nMATA PELAJARAN: ${mataPelajaran}` : ''}${soalContext ? `\n\nKONTEKS SOAL (pakai istilah/label yang konsisten dengan teks ini):\n${String(soalContext).slice(0, 500)}` : ''}

DESKRIPSI MENTAH:
${String(rawPrompt || '').trim()}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, ...extraHeaders },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      stream: false,
      messages: [{ role: 'user', content: systemPrompt }]
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`refine prompt ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await parseCompletionResponse(res);
  const msg = data?.choices?.[0]?.message?.content;
  // Beberapa provider mengembalikan content sebagai array of parts
  const text = Array.isArray(msg)
    ? msg.map(p => p?.text || '').join('')
    : (typeof msg === 'string' ? msg : '');
  // Hapus tanda kutip HANYA jika menjadi pasangan pembungkus seluruh teks
  let refined = text.trim();
  const first = refined[0], last = refined[refined.length - 1];
  if (refined.length > 1 && ['"', "'", '`'].includes(first) && first === last) {
    refined = refined.slice(1, -1).trim();
  }
  if (!refined) throw new Error('Refine prompt mengembalikan teks kosong');
  return refined;
}

// Ambil URL gambar dari respons chat/completions dengan modalities.
// Bentuk umum: choices[0].message.images[0] = { type: 'image_url', image_url: { url: 'data:...;base64,...' } }
function extractImageUrlFromChat(data) {
  const msg = data?.choices?.[0]?.message;
  const img = msg?.images?.[0];
  if (!img) return null;
  return img?.image_url?.url || img?.url || (typeof img === 'string' ? img : null);
}

async function generateViaImagesEndpoint({ baseUrl, apiKey, extraHeaders, model, prompt }) {
  const res = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, ...extraHeaders },
    body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`/images/generations ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const item = data?.data?.[0];
  if (item?.b64_json) return { base64: item.b64_json, mimeType: 'image/png' };
  if (item?.url) return { url: item.url };
  throw new Error('Respons /images/generations tidak memuat gambar');
}

async function generateViaChatModalities({ baseUrl, apiKey, extraHeaders, model, prompt }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, ...extraHeaders },
    body: JSON.stringify({
      model,
      modalities: ['image', 'text'],
      stream: false,
      messages: [{ role: 'user', content: prompt }]
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`/chat/completions ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await parseCompletionResponse(res);
  const url = extractImageUrlFromChat(data);
  if (!url) throw new Error('Respons chat modalities tidak memuat gambar');
  if (url.startsWith('data:')) {
    const [meta, b64] = url.split(',');
    const mimeType = meta.match(/data:([^;]+)/)?.[1] || 'image/png';
    return { base64: b64, mimeType };
  }
  return { url };
}

async function downloadImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Gagal mengunduh gambar: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
  return { buffer, mimeType };
}

/**
 * Generate gambar via model AI. Balikin { buffer, mimeType }.
 * - provider 'openrouter' → chat modalities dulu (fallback images endpoint)
 * - provider lain (9router, dll.) → /images/generations dulu (fallback chat modalities)
 */
export async function generateImageBuffer(imagePrompt, { model, provider = 'openrouter', baseUrl, apiKey, extraHeaders = {} }) {
  const prompt = buildImagePrompt(imagePrompt);
  const errors = [];
  const attempts = provider === 'openrouter' ? ['chat', 'images'] : ['images', 'chat'];

  for (const attempt of attempts) {
    try {
      const result = attempt === 'images'
        ? await generateViaImagesEndpoint({ baseUrl, apiKey, extraHeaders, model, prompt })
        : await generateViaChatModalities({ baseUrl, apiKey, extraHeaders, model, prompt });

      if (result.base64) {
        return { buffer: Buffer.from(result.base64, 'base64'), mimeType: result.mimeType || 'image/png' };
      }
      return await downloadImage(result.url);
    } catch (err) {
      errors.push(`${attempt}: ${err.message}`);
    }
  }
  throw new Error(`Semua metode image gen gagal → ${errors.join(' | ')}`);
}

const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

/**
 * Simpan buffer gambar ke storage + catat di uploaded_files.
 * Balikin URL publik (/api/uploads/<file>) untuk soal.image_url.
 */
export function saveGeneratedImage(userId, buffer, mimeType = 'image/png') {
  const ext = MIME_EXT[mimeType] || '.png';
  const filename = `${uuidv4()}${ext}`;
  const filepath = path.join(STORAGE_DIR, filename);
  fs.writeFileSync(filepath, buffer);

  const url = `/api/uploads/${filename}`;
  db.prepare(`
    INSERT INTO uploaded_files (id, user_id, filename, original_name, mime_type, size, url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, filename, `ai-generated${ext}`, mimeType, buffer.length, url);

  return url;
}

export function shouldGenerateImage(soalData) {
  return soalData.need_image === true && typeof soalData.image_prompt === 'string' && soalData.image_prompt.trim().length > 5;
}
