import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/init.js';

/**
 * Resolve provider-specific configuration for a user.
 * Falls back to env vars when per-user config not set.
 */
function resolveProviderConfig(provider, userId) {
  const isOpenRouter = provider === 'openrouter';
  const baseUrl = isOpenRouter
    ? process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
    : process.env.NINEROUTER_BASE_URL || 'http://localhost:20128/v1';

  const configKey = isOpenRouter ? 'openrouter_api_key' : 'ninerouter_api_key';
  const envFallbackKey = isOpenRouter ? 'OPENROUTER_API_KEY' : 'NINEROUTER_API_KEY';

  const configRow = db.prepare('SELECT value FROM app_config WHERE user_id = ? AND key = ?')
    .get(userId, configKey);
  const apiKey = configRow?.value || process.env[envFallbackKey] || '';

  const extraHeaders = isOpenRouter
    ? { 'HTTP-Referer': 'https://sekulkit.app', 'X-Title': 'SekulKit' }
    : {};

  return { baseUrl, apiKey, extraHeaders };
}

/**
 * Test connection to a provider using its /models endpoint.
 */
async function testProviderConnection(provider, userId) {
  const { baseUrl, apiKey, extraHeaders } = resolveProviderConfig(provider, userId);

  if (!apiKey && provider === '9router') {
    // 9router local sering no-auth — allow empty key
  } else if (!apiKey) {
    return { success: false, message: `API Key ${provider} belum dikonfigurasi` };
  }

  try {
    const r = await fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, ...extraHeaders }
    });
    if (!r.ok) throw new Error(`Status ${r.status}`);
    const data = await r.json();
    return { success: true, message: `${provider} API Key valid`, model_count: data.data?.length || 0 };
  } catch (err) {
    return { success: false, message: `${provider} API Key tidak valid: ${err.message}` };
  }
}

/**
 * Fetch remote model list from provider, normalized to common shape.
 */
async function fetchRemoteModels(provider, userId) {
  const { baseUrl, apiKey, extraHeaders } = resolveProviderConfig(provider, userId);

  if (!apiKey && provider === '9router') {
    // allow no-auth
  } else if (!apiKey) {
    throw new Error(`API Key ${provider} belum dikonfigurasi`);
  }

  const r = await fetch(`${baseUrl}/models`, {
    headers: { 'Authorization': `Bearer ${apiKey}`, ...extraHeaders }
  });
  if (!r.ok) throw new Error(`Status ${r.status}`);
  const data = await r.json();

  // Normalize: provider responses may differ slightly
  const rawModels = data.data || [];
  const models = rawModels.map(m => {
    // OpenRouter has `pricing.prompt === '0'` for free
    // 9router / OpenAI-compatible may not have pricing — treat all as potentially free
    const isFree = m.pricing?.prompt === '0' || !m.pricing;
    return {
      id: m.id,
      name: m.name,
      context_length: m.context_length,
      is_free: isFree,
      pricing: m.pricing
    };
  }).sort((a, b) => (b.is_free ? 1 : 0) - (a.is_free ? 1 : 0));

  return models;
}

export { resolveProviderConfig };

export const configController = {
  // APP CONFIG (key-value store per user)
  getConfig(req, res) {
    const configs = db.prepare('SELECT key, value FROM app_config WHERE user_id = ?').all(req.user.id);
    const result = {};
    configs.forEach(c => {
      result[c.key] = c.key.includes('api_key') ? '***' + c.value.slice(-4) : c.value;
    });
    res.json({ data: result });
  },

  setConfig(req, res) {
    const { key, value } = req.body;
    if (!key || value === undefined) return res.status(400).json({ message: 'Key dan value diperlukan' });

    const id = uuidv4();
    db.prepare(`
      INSERT INTO app_config (id, user_id, key, value) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(id, req.user.id, key, value);

    res.json({ message: 'Konfigurasi disimpan' });
  },

  // AI MODELS
  getModels(req, res) {
    const models = db.prepare('SELECT * FROM ai_models WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json({ data: models });
  },

  createModel(req, res) {
    const { name, model_id, provider = 'openrouter', type = 'text', max_tokens = 4096, temperature = 0.7, notes } = req.body;
    if (!name || !model_id) return res.status(400).json({ message: 'Name dan model_id wajib diisi' });

    const id = uuidv4();
    const modelType = ['text', 'image'].includes(type) ? type : 'text';
    const count = db.prepare('SELECT COUNT(*) as c FROM ai_models WHERE user_id = ? AND type = ?').get(req.user.id, modelType).c;
    const is_default = count === 0 ? 1 : 0;

    db.prepare(`
      INSERT INTO ai_models (id, user_id, name, model_id, provider, type, max_tokens, temperature, notes, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, name, model_id, provider, modelType, max_tokens, temperature, notes, is_default);

    res.status(201).json({ data: db.prepare('SELECT * FROM ai_models WHERE id = ?').get(id) });
  },

  updateModel(req, res) {
    const model = db.prepare('SELECT id FROM ai_models WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!model) return res.status(404).json({ message: 'Model tidak ditemukan' });

    const { name, model_id, provider, type, max_tokens, temperature, notes } = req.body;
    // provider/type optional update (defaults to existing if not sent)
    const updateFields = ['name=?', 'model_id=?', 'max_tokens=?', 'temperature=?', 'notes=?'];
    const updateValues = [name, model_id, max_tokens, temperature, notes];
    if (provider) {
      updateFields.push('provider=?');
      updateValues.push(provider);
    }
    if (type && ['text', 'image'].includes(type)) {
      updateFields.push('type=?');
      updateValues.push(type);
    }
    updateValues.push(req.params.id);

    db.prepare(`UPDATE ai_models SET ${updateFields.join(', ')} WHERE id=?`).run(...updateValues);

    res.json({ data: db.prepare('SELECT * FROM ai_models WHERE id = ?').get(req.params.id) });
  },

  deleteModel(req, res) {
    const model = db.prepare('SELECT id FROM ai_models WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!model) return res.status(404).json({ message: 'Model tidak ditemukan' });
    db.prepare('DELETE FROM ai_models WHERE id = ?').run(req.params.id);
    res.json({ message: 'Model dihapus' });
  },

  setDefaultModel(req, res) {
    const model = db.prepare('SELECT id, type FROM ai_models WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!model) return res.status(404).json({ message: 'Model tidak ditemukan' });
    // Default per tipe: default model teks tidak terpengaruh saat set default model gambar, dst.
    const type = model.type || 'text';
    db.prepare('UPDATE ai_models SET is_default = 0 WHERE user_id = ? AND type = ?').run(req.user.id, type);
    db.prepare('UPDATE ai_models SET is_default = 1 WHERE id = ?').run(req.params.id);
    res.json({ message: 'Default model diperbarui' });
  },

  // PROMPT TEMPLATES
  getTemplates(req, res) {
    const templates = db.prepare('SELECT * FROM prompt_templates WHERE user_id = ? ORDER BY jenis_soal, name').all(req.user.id);
    res.json({ data: templates });
  },

  createTemplate(req, res) {
    const { name, jenis_soal, template } = req.body;
    if (!name || !jenis_soal || !template) return res.status(400).json({ message: 'Semua field wajib diisi' });

    const id = uuidv4();
    db.prepare('INSERT INTO prompt_templates (id, user_id, name, jenis_soal, template) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.user.id, name, jenis_soal, template);
    res.status(201).json({ data: db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(id) });
  },

  updateTemplate(req, res) {
    const tmpl = db.prepare('SELECT id FROM prompt_templates WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!tmpl) return res.status(404).json({ message: 'Template tidak ditemukan' });
    const { name, jenis_soal, template } = req.body;
    db.prepare("UPDATE prompt_templates SET name=?, jenis_soal=?, template=?, updated_at=datetime('now') WHERE id=?")
      .run(name, jenis_soal, template, req.params.id);
    res.json({ data: db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(req.params.id) });
  },

  deleteTemplate(req, res) {
    const tmpl = db.prepare('SELECT id FROM prompt_templates WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!tmpl) return res.status(404).json({ message: 'Template tidak ditemukan' });
    db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(req.params.id);
    res.json({ message: 'Template dihapus' });
  },

  // Provider-aware connection test
  async testApiKey(req, res) {
    const provider = req.query.provider || 'openrouter';
    const result = await testProviderConnection(provider, req.user.id);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  },

  // Provider-aware remote model listing
  async getOpenRouterModels(req, res) {
    const provider = req.query.provider || 'openrouter';
    try {
      const models = await fetchRemoteModels(provider, req.user.id);
      res.json({ data: models });
    } catch (err) {
      res.status(500).json({ message: `Gagal mengambil daftar model ${provider}: ${err.message}` });
    }
  },

  // Alias for backward compatibility
  async getRemoteModels(req, res) {
    // same handler, just a nicer route name
    const provider = req.query.provider || 'openrouter';
    try {
      const models = await fetchRemoteModels(provider, req.user.id);
      res.json({ data: models });
    } catch (err) {
      res.status(500).json({ message: `Gagal mengambil daftar model ${provider}: ${err.message}` });
    }
  }
};