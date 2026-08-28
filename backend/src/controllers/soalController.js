import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/init.js';
import { resolveProviderConfig } from './configController.js';

function getSoalWithOpsi(soalId) {
  const soal = db.prepare('SELECT * FROM soal WHERE id = ?').get(soalId);
  if (!soal) return null;
  const opsi = db.prepare('SELECT * FROM opsi_jawaban WHERE soal_id = ? ORDER BY urutan').all(soalId);
  return { ...soal, opsi, tags: JSON.parse(soal.tags || '[]') };
}

function updateBankTotal(bankId) {
  const count = db.prepare('SELECT COUNT(*) as c FROM soal WHERE bank_soal_id = ?').get(bankId).c;
  db.prepare("UPDATE bank_soal SET total_soal = ?, updated_at = datetime('now') WHERE id = ?").run(count, bankId);
}

export const soalController = {
  getByBank(req, res) {
    const { bank_soal_id } = req.params;
    const { jenis, kesulitan, bab, verified, page = 1, limit = 50 } = req.query;

    // Verify bank belongs to user
    const bank = db.prepare('SELECT id FROM bank_soal WHERE id = ? AND user_id = ?').get(bank_soal_id, req.user.id);
    if (!bank) return res.status(404).json({ message: 'Bank soal tidak ditemukan' });

    let query = 'SELECT * FROM soal WHERE bank_soal_id = ?';
    const params = [bank_soal_id];
    if (jenis) { query += ' AND jenis = ?'; params.push(jenis); }
    if (kesulitan) { query += ' AND tingkat_kesulitan = ?'; params.push(kesulitan); }
    if (bab) { query += ' AND bab LIKE ?'; params.push(`%${bab}%`); }
    if (verified !== undefined) { query += ' AND is_verified = ?'; params.push(verified === 'true' ? 1 : 0); }

    const offset = (Number(page) - 1) * Number(limit);
    const total = db.prepare(`SELECT COUNT(*) as c FROM soal WHERE bank_soal_id = ?${jenis ? ' AND jenis = ?' : ''}`).get(...[bank_soal_id, ...(jenis ? [jenis] : [])]).c;

    query += ` ORDER BY nomor_urut ASC, created_at ASC LIMIT ? OFFSET ?`;
    params.push(Number(limit), offset);

    const soals = db.prepare(query).all(...params).map(s => {
      const opsi = db.prepare('SELECT * FROM opsi_jawaban WHERE soal_id = ? ORDER BY urutan').all(s.id);
      return { ...s, opsi, tags: JSON.parse(s.tags || '[]') };
    });

    res.json({ data: soals, total, page: Number(page), limit: Number(limit) });
  },

  getOne(req, res) {
    const soal = getSoalWithOpsi(req.params.id);
    if (!soal || soal.user_id !== req.user.id) {
      return res.status(404).json({ message: 'Soal tidak ditemukan' });
    }
    res.json({ data: soal });
  },

  create(req, res) {
    const { bank_soal_id, bab, materi, jenis, pertanyaan, tingkat_kesulitan, skor, pembahasan, tags, opsi } = req.body;

    const bank = db.prepare('SELECT id FROM bank_soal WHERE id = ? AND user_id = ?').get(bank_soal_id, req.user.id);
    if (!bank) return res.status(403).json({ message: 'Bank soal tidak ditemukan' });

    const id = uuidv4();
    const maxNomor = db.prepare('SELECT MAX(nomor_urut) as m FROM soal WHERE bank_soal_id = ?').get(bank_soal_id).m || 0;

    db.prepare(`
      INSERT INTO soal (id, bank_soal_id, user_id, bab, materi, jenis, pertanyaan, tingkat_kesulitan, skor, pembahasan, tags, nomor_urut)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, bank_soal_id, req.user.id, bab, materi, jenis || 'pg', pertanyaan, tingkat_kesulitan || 'sedang',
      skor || 10, pembahasan, JSON.stringify(tags || []), maxNomor + 1);

    if (opsi && opsi.length > 0) {
      const insertOpsi = db.prepare('INSERT INTO opsi_jawaban (id, soal_id, label, teks, is_benar, urutan) VALUES (?, ?, ?, ?, ?, ?)');
      db.transaction(() => {
        opsi.forEach((o, i) => insertOpsi.run(uuidv4(), id, o.label, o.teks, o.is_benar ? 1 : 0, i));
      })();
    }

    updateBankTotal(bank_soal_id);
    res.status(201).json({ data: getSoalWithOpsi(id) });
  },

  update(req, res) {
    const existing = db.prepare('SELECT * FROM soal WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ message: 'Soal tidak ditemukan' });

    const { bab, materi, jenis, pertanyaan, tingkat_kesulitan, skor, pembahasan, tags, opsi, is_verified, image_prompt } = req.body;

    // image_prompt opsional (diedit dari halaman edit soal); undefined = pertahankan lama
    const finalImagePrompt = image_prompt !== undefined ? image_prompt : existing.image_prompt;

    db.prepare(`
      UPDATE soal SET bab=?, materi=?, jenis=?, pertanyaan=?, tingkat_kesulitan=?, skor=?,
      pembahasan=?, tags=?, is_verified=?, image_prompt=?, updated_at=datetime('now') WHERE id=?
    `).run(bab, materi, jenis, pertanyaan, tingkat_kesulitan, skor || 10,
      pembahasan, JSON.stringify(tags || []), is_verified ? 1 : 0, finalImagePrompt, req.params.id);

    // Update opsi
    if (opsi !== undefined) {
      db.prepare('DELETE FROM opsi_jawaban WHERE soal_id = ?').run(req.params.id);
      if (opsi.length > 0) {
        const insertOpsi = db.prepare('INSERT INTO opsi_jawaban (id, soal_id, label, teks, is_benar, urutan) VALUES (?, ?, ?, ?, ?, ?)');
        db.transaction(() => {
          opsi.forEach((o, i) => insertOpsi.run(uuidv4(), req.params.id, o.label, o.teks, o.is_benar ? 1 : 0, i));
        })();
      }
    }

    res.json({ data: getSoalWithOpsi(req.params.id) });
  },

  delete(req, res) {
    const soal = db.prepare('SELECT * FROM soal WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!soal) return res.status(404).json({ message: 'Soal tidak ditemukan' });
    db.prepare('DELETE FROM soal WHERE id = ?').run(req.params.id);
    updateBankTotal(soal.bank_soal_id);
    res.json({ message: 'Soal dihapus' });
  },

  reorder(req, res) {
    const { orders } = req.body; // [{ id, nomor_urut }]
    const update = db.prepare("UPDATE soal SET nomor_urut = ? WHERE id = ? AND user_id = ?");
    db.transaction(() => {
      orders.forEach(o => update.run(o.nomor_urut, o.id, req.user.id));
    })();
    res.json({ message: 'Urutan diperbarui' });
  },

  bulkDelete(req, res) {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ message: 'IDs diperlukan' });

    const soal = db.prepare('SELECT bank_soal_id FROM soal WHERE id = ? AND user_id = ?').get(ids[0], req.user.id);
    const bankId = soal?.bank_soal_id;

    const del = db.prepare('DELETE FROM soal WHERE id = ? AND user_id = ?');
    db.transaction(() => {
      ids.forEach(id => del.run(id, req.user.id));
    })();

    if (bankId) updateBankTotal(bankId);
    res.json({ message: `${ids.length} soal dihapus` });
  }
};

// Regenerate image untuk satu soal
export const soalImageController = {
  async regenerateImage(req, res) {
    const { id } = req.params;
    const soal = db.prepare('SELECT * FROM soal WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!soal) return res.status(404).json({ message: 'Soal tidak ditemukan' });

    const { image_prompt, custom_prompt, image_model_id } = req.body || {};
    const finalPrompt = custom_prompt || image_prompt || soal.image_prompt;
    if (!finalPrompt) return res.status(400).json({ message: 'Image prompt diperlukan' });

    // Model gambar: dari request, atau default model bertipe 'image' milik user
    let imageModel = null;
    if (image_model_id) {
      imageModel = db.prepare("SELECT * FROM ai_models WHERE id = ? AND user_id = ? AND type = 'image'").get(image_model_id, req.user.id);
      if (!imageModel) return res.status(404).json({ message: 'Model gambar tidak ditemukan' });
    } else {
      imageModel = db.prepare(`
        SELECT * FROM ai_models WHERE user_id = ? AND type = 'image'
        ORDER BY is_default DESC, created_at DESC LIMIT 1
      `).get(req.user.id);
    }
    if (!imageModel) {
      return res.status(400).json({ message: 'Belum ada model gambar (type=image) dikonfigurasi. Tambahkan di Konfigurasi → Model AI.' });
    }

    const provider = imageModel.provider || 'openrouter';
    const { baseUrl, apiKey, extraHeaders } = resolveProviderConfig(provider, req.user.id);
    if (!apiKey && provider !== '9router') {
      return res.status(400).json({ message: `API Key ${provider} belum dikonfigurasi` });
    }

    try {
      const { generateImageBuffer, saveGeneratedImage, refineImagePrompt, buildImagePrompt } = await import('../utils/imageGen.js');

      // Refine prompt via default model teks user (kalau ada) — sama seperti flow generate.
      // Gagal refine → fallback prompt mentah + style suffix default.
      let refinedPrompt;
      const textModel = db.prepare(`
        SELECT * FROM ai_models WHERE user_id = ? AND type = 'text'
        ORDER BY is_default DESC, created_at DESC LIMIT 1
      `).get(req.user.id);
      if (textModel) {
        const tProvider = textModel.provider || 'openrouter';
        const tCfg = resolveProviderConfig(tProvider, req.user.id);
        if (tCfg.apiKey || tProvider === '9router') {
          try {
            const bank = db.prepare('SELECT mata_pelajaran FROM bank_soal WHERE id = ?').get(soal.bank_soal_id);
            refinedPrompt = await refineImagePrompt(finalPrompt, {
              model: textModel.model_id,
              baseUrl: tCfg.baseUrl,
              apiKey: tCfg.apiKey,
              extraHeaders: tCfg.extraHeaders,
              mataPelajaran: bank?.mata_pelajaran || '',
              soalContext: soal.pertanyaan || ''
            });
          } catch (refineErr) {
            console.error('Refine prompt gagal, pakai prompt mentah:', refineErr.message);
          }
        }
      }
      if (!refinedPrompt) refinedPrompt = buildImagePrompt(finalPrompt);

      const { buffer, mimeType } = await generateImageBuffer(refinedPrompt, {
        model: imageModel.model_id,
        provider,
        baseUrl,
        apiKey,
        extraHeaders
      });
      const url = saveGeneratedImage(req.user.id, buffer, mimeType);
      db.prepare("UPDATE soal SET image_url = ?, image_prompt = ?, updated_at = datetime('now') WHERE id = ?")
        .run(url, finalPrompt, id);
      res.json({ data: { image_url: url, image_prompt: finalPrompt, refined_prompt: refinedPrompt } });
    } catch (err) {
      res.status(500).json({ message: 'Gagal generate gambar: ' + err.message });
    }
  },

  removeImage(req, res) {
    const { id } = req.params;
    const soal = db.prepare('SELECT id FROM soal WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!soal) return res.status(404).json({ message: 'Soal tidak ditemukan' });
    db.prepare("UPDATE soal SET image_url = NULL, image_prompt = NULL WHERE id = ?").run(id);
    res.json({ message: 'Gambar dihapus' });
  }
};
