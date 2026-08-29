<template>
  <div class="p-6 max-w-4xl mx-auto">
    <div class="mb-6">
      <h2 class="text-xl font-bold text-slate-900">Konfigurasi</h2>
      <p class="text-slate-500 text-sm mt-1">Atur API key, model AI, dan preferensi lainnya</p>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 bg-slate-100 p-1 rounded-xl mb-6 w-fit">
      <button v-for="tab in tabs" :key="tab.id" @click="activeTab = tab.id"
        class="px-4 py-2 rounded-lg text-sm font-medium transition-all"
        :class="activeTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-800'">
        {{ tab.label }}
      </button>
    </div>

    <!-- Tab: API Key -->
    <div v-if="activeTab === 'api'" class="space-y-5">
      <div class="card">
        <div class="card-header"><h3 class="font-semibold text-slate-800">OpenRouter API Key</h3></div>
        <div class="card-body space-y-4">
          <p class="text-sm text-slate-600">
            Dapatkan API key gratis di <a href="https://openrouter.ai/keys" target="_blank" class="text-primary-600 underline">openrouter.ai/keys</a>.
            OpenRouter menyediakan akses ke banyak model AI, termasuk yang gratis.
          </p>
          <div>
            <label class="label">API Key</label>
            <div class="flex gap-2">
              <input v-model="apiKey" :type="showKey ? 'text' : 'password'" class="input flex-1 font-mono" placeholder="sk-or-..." />
              <button @click="showKey = !showKey" class="btn-secondary">{{ showKey ? 'Sembunyikan' : 'Tampilkan' }}</button>
            </div>
          </div>
          <div class="flex gap-3">
            <button @click="saveApiKey" class="btn-primary" :disabled="savingKey">
              {{ savingKey ? 'Menyimpan...' : 'Simpan API Key' }}
            </button>
            <button @click="testApiKey('openrouter')" class="btn-secondary" :disabled="testingKey">
              {{ testingKey ? 'Testing...' : 'Test Koneksi' }}
            </button>
          </div>
          <div v-if="testResult" :class="testResult.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'" class="rounded-lg p-3 text-sm">
            {{ testResult.message }}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 class="font-semibold text-slate-800">9router (opsional)</h3></div>
        <div class="card-body space-y-4">
          <p class="text-sm text-slate-600">
            9router adalah proxy AI lokal. Cocok untuk development atau jika punya endpoint OpenAI-compatible sendiri.
          </p>
          <div>
            <label class="label">Base URL</label>
            <input v-model="ninerouterBaseUrl" type="text" class="input font-mono" placeholder="http://localhost:20128/v1" />
          </div>
          <div>
            <label class="label">API Key (opsional)</label>
            <div class="flex gap-2">
              <input v-model="ninerouterApiKey" :type="showNrKey ? 'text' : 'password'" class="input flex-1 font-mono" placeholder="Kosongkan jika no-auth" />
              <button @click="showNrKey = !showNrKey" class="btn-secondary">{{ showNrKey ? 'Sembunyikan' : 'Tampilkan' }}</button>
            </div>
          </div>
          <div class="flex gap-3">
            <button @click="saveNinerouterConfig" class="btn-primary" :disabled="savingNrKey">
              {{ savingNrKey ? 'Menyimpan...' : 'Simpan' }}
            </button>
            <button @click="testApiKey('9router')" class="btn-secondary" :disabled="testingNrKey">
              {{ testingNrKey ? 'Testing...' : 'Test Koneksi' }}
            </button>
          </div>
          <div v-if="testNrResult" :class="testNrResult.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'" class="rounded-lg p-3 text-sm">
            {{ testNrResult.message }}
          </div>
        </div>
      </div>
    </div>

    <!-- Tab: Model AI -->
    <div v-if="activeTab === 'models'" class="space-y-5">
      <div class="flex items-center justify-between">
        <p class="text-sm text-slate-600">Model <strong>Teks</strong> untuk generate soal, model <strong>Gambar</strong> untuk ilustrasi soal.</p>
        <button @click="openModelForm()" class="btn-primary btn-sm">+ Tambah Model</button>
      </div>

      <!-- Browse from Provider -->
      <div class="card">
        <div class="card-header">
          <div class="flex items-center gap-3">
            <h3 class="font-semibold text-slate-800 text-sm">Cari Model</h3>
            <div class="flex gap-1 bg-slate-100 p-0.5 rounded-lg">
              <button @click="browseProvider = 'openrouter'"
                class="px-2.5 py-1 rounded-md text-xs font-medium transition-all"
                :class="browseProvider === 'openrouter' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'">
                OpenRouter
              </button>
              <button @click="browseProvider = '9router'"
                class="px-2.5 py-1 rounded-md text-xs font-medium transition-all"
                :class="browseProvider === '9router' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'">
                9router
              </button>
            </div>
          </div>
          <button @click="loadRemoteModels" class="btn-secondary btn-sm" :disabled="loadingOR">
            {{ loadingOR ? 'Memuat...' : 'Muat Daftar Model' }}
          </button>
        </div>
        <div v-if="orModels.length > 0" class="divide-y divide-slate-100 max-h-80 overflow-y-auto">
          <div v-for="m in orModels.slice(0, 50)" :key="m.id"
            class="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-800 truncate">{{ m.name }}</p>
              <p class="text-xs text-slate-500 font-mono truncate">{{ m.id }}</p>
            </div>
            <span v-if="m.is_free" class="badge badge-green text-xs">Gratis</span>
            <button @click="quickAddModel(m)" class="btn-secondary btn-sm flex-shrink-0">+ Tambah</button>
          </div>
        </div>
      </div>

      <!-- Saved models -->
      <div v-if="models.length > 0" class="space-y-3">
        <h3 class="font-semibold text-slate-700 text-sm">Model Tersimpan ({{ models.length }})</h3>
        <div v-for="m in models" :key="m.id" class="card p-4">
          <div class="flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <p class="font-semibold text-slate-800">{{ m.name }}</p>
                <span v-if="m.is_default" class="badge badge-primary">Default</span>
                <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{{ m.provider || 'openrouter' }}</span>
                <span v-if="(m.type || 'text') === 'image'" class="badge bg-violet-50 text-violet-600">Gambar</span>
                <span v-else class="badge bg-slate-100 text-slate-500">Teks</span>
              </div>
              <p class="text-xs text-slate-500 font-mono mt-0.5">{{ m.model_id }}</p>
              <p v-if="(m.type || 'text') === 'text'" class="text-xs text-slate-500 mt-1">Max tokens: {{ m.max_tokens }} · Temp: {{ m.temperature }}</p>
              <p v-else class="text-xs text-slate-500 mt-1">Model gambar ilustrasi soal</p>
            </div>
            <div class="flex items-center gap-2">
              <button v-if="!m.is_default" @click="setDefault(m.id)" class="btn-secondary btn-sm">Set Default</button>
              <button @click="openModelForm(m)" class="btn-ghost btn-sm">Edit</button>
              <button @click="deleteModel(m.id)" class="btn-ghost btn-sm text-red-500 hover:bg-red-50">Hapus</button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="card p-8 text-center text-slate-400 text-sm">Belum ada model. Tambah model di atas.</div>
    </div>

    <!-- Tab: Prompt Templates -->
    <div v-if="activeTab === 'templates'" class="space-y-5">
      <div class="flex items-center justify-between">
        <p class="text-sm text-slate-600">Kustomisasi prompt untuk setiap jenis soal.</p>
        <button @click="openTemplateForm()" class="btn-primary btn-sm">+ Tambah Template</button>
      </div>
      <div v-if="templates.length === 0" class="card p-8 text-center text-slate-400 text-sm">
        Belum ada template kustom. Sistem menggunakan template bawaan.
      </div>
      <div v-for="t in templates" :key="t.id" class="card p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <p class="font-semibold text-slate-800">{{ t.name }}</p>
              <span :class="`jenis-${t.jenis_soal}`">{{ t.jenis_soal }}</span>
            </div>
            <pre class="text-xs text-slate-500 mt-2 whitespace-pre-wrap line-clamp-3 bg-slate-50 p-2 rounded">{{ t.template }}</pre>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            <button @click="openTemplateForm(t)" class="btn-ghost btn-sm">Edit</button>
            <button @click="deleteTemplate(t.id)" class="btn-ghost btn-sm text-red-500 hover:bg-red-50">Hapus</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Model form modal -->
    <div v-if="showModelForm" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" @click.self="showModelForm = false">
      <div class="bg-white rounded-2xl w-full max-w-md p-6 animate-slide-up">
        <h3 class="text-lg font-semibold mb-5">{{ editModelId ? 'Edit Model' : 'Tambah Model AI' }}</h3>
        <div class="space-y-3">
          <div>
            <label class="label">Tipe Model</label>
            <select v-model="modelForm.type" class="input">
              <option value="text">Teks — generate soal</option>
              <option value="image">Gambar — ilustrasi soal</option>
            </select>
          </div>
          <div>
            <label class="label">Nama / Label</label>
            <input v-model="modelForm.name" type="text" class="input" placeholder="cth: Llama 3.1 (Free)" />
          </div>
          <div>
            <label class="label">Provider</label>
            <select v-model="modelForm.provider" class="input">
              <option value="openrouter">OpenRouter</option>
              <option value="9router">9router</option>
            </select>
          </div>
          <div>
            <label class="label">Model ID</label>
            <input v-model="modelForm.model_id" type="text" class="input font-mono"
              :placeholder="modelForm.type === 'image'
                ? 'cth: google/gemini-2.5-flash-image'
                : (modelForm.provider === '9router' ? 'cth: gpt-4o-mini' : 'cth: meta-llama/llama-3.1-8b-instruct:free')" />
            <p v-if="modelForm.type === 'image'" class="text-xs text-slate-400 mt-1">
              OpenRouter: gemini image models. 9router: model OpenAI-compatible dengan endpoint /images/generations.
            </p>
          </div>
          <div v-if="modelForm.type === 'text'" class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">Max Tokens</label>
              <input v-model.number="modelForm.max_tokens" type="number" class="input" />
            </div>
            <div>
              <label class="label">Temperature (0-2)</label>
              <input v-model.number="modelForm.temperature" type="number" step="0.1" min="0" max="2" class="input" />
            </div>
          </div>
          <div>
            <label class="label">Catatan (opsional)</label>
            <input v-model="modelForm.notes" type="text" class="input" placeholder="cth: Model gratis, cocok untuk soal PG" />
          </div>
        </div>
        <div class="flex gap-3 mt-5">
          <button @click="showModelForm = false" class="btn-secondary flex-1 justify-center">Batal</button>
          <button @click="saveModel" class="btn-primary flex-1 justify-center" :disabled="savingModel">
            {{ savingModel ? 'Menyimpan...' : 'Simpan' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Template form modal -->
    <div v-if="showTemplateForm" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" @click.self="showTemplateForm = false">
      <div class="bg-white rounded-2xl w-full max-w-2xl p-6 animate-slide-up">
        <h3 class="text-lg font-semibold mb-5">{{ editTemplateId ? 'Edit Template' : 'Tambah Prompt Template' }}</h3>
        <div class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">Nama Template</label>
              <input v-model="templateForm.name" type="text" class="input" placeholder="cth: Template PG Ketat" />
            </div>
            <div>
              <label class="label">Jenis Soal</label>
              <select v-model="templateForm.jenis_soal" class="input">
                <option value="pg">PG</option><option value="pgk">PGK</option>
                <option value="essay">Essay</option><option value="isian">Isian</option>
                <option value="benar_salah">Benar/Salah</option>
              </select>
            </div>
          </div>
          <div>
            <label class="label">Prompt Template</label>
            <textarea v-model="templateForm.template" rows="10" class="input font-mono text-xs resize-y" placeholder="Tulis prompt template..."></textarea>
            <p class="text-xs text-slate-400 mt-1">Gunakan variabel: {mata_pelajaran}, {bab}, {materi}, {jumlah}, {tingkat_kesulitan}</p>
          </div>
        </div>
        <div class="flex gap-3 mt-5">
          <button @click="showTemplateForm = false" class="btn-secondary flex-1 justify-center">Batal</button>
          <button @click="saveTemplate" class="btn-primary flex-1 justify-center" :disabled="savingTemplate">Simpan</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useToast } from 'vue-toastification'
import api from '../utils/api.js'

const toast = useToast()
const activeTab = ref('api')
const tabs = [
  { id: 'api', label: 'API Key' },
  { id: 'models', label: 'Model AI' },
  { id: 'templates', label: 'Prompt Template' }
]

// API Key - OpenRouter
const apiKey = ref('')
const showKey = ref(false)
const savingKey = ref(false)
const testingKey = ref(false)
const testResult = ref(null)

// API Key - 9router
const ninerouterBaseUrl = ref('http://localhost:20128/v1')
const ninerouterApiKey = ref('')
const showNrKey = ref(false)
const savingNrKey = ref(false)
const testingNrKey = ref(false)
const testNrResult = ref(null)

// Models
const models = ref([])
const orModels = ref([])
const loadingOR = ref(false)
const browseProvider = ref('openrouter')
const showModelForm = ref(false)
const editModelId = ref(null)
const savingModel = ref(false)
const modelForm = ref({ name: '', provider: 'openrouter', model_id: '', type: 'text', max_tokens: 4096, temperature: 0.7, notes: '' })

// Templates
const templates = ref([])
const showTemplateForm = ref(false)
const editTemplateId = ref(null)
const savingTemplate = ref(false)
const templateForm = ref({ name: '', jenis_soal: 'pg', template: '' })

async function saveApiKey() {
  if (!apiKey.value) return toast.error('API key tidak boleh kosong')
  savingKey.value = true
  try {
    await api.post('/config', { key: 'openrouter_api_key', value: apiKey.value })
    toast.success('API key disimpan!')
  } catch { toast.error('Gagal menyimpan') }
  finally { savingKey.value = false }
}

async function saveNinerouterConfig() {
  savingNrKey.value = true
  try {
    if (ninerouterBaseUrl.value) {
      await api.post('/config', { key: 'ninerouter_base_url', value: ninerouterBaseUrl.value })
    }
    await api.post('/config', { key: 'ninerouter_api_key', value: ninerouterApiKey.value || '' })
    toast.success('Konfigurasi 9router disimpan!')
  } catch { toast.error('Gagal menyimpan') }
  finally { savingNrKey.value = false }
}

async function testApiKey(provider = 'openrouter') {
  if (provider === '9router') {
    testingNrKey.value = true
    testNrResult.value = null
  } else {
    testingKey.value = true
    testResult.value = null
  }
  try {
    const { data } = await api.get(`/config/test-api-key?provider=${provider}`)
    if (provider === '9router') testNrResult.value = data
    else testResult.value = data
  } catch (err) {
    const result = { success: false, message: err.response?.data?.message || 'Koneksi gagal' }
    if (provider === '9router') testNrResult.value = result
    else testResult.value = result
  } finally {
    testingKey.value = false
    testingNrKey.value = false
  }
}

async function loadRemoteModels() {
  loadingOR.value = true
  orModels.value = []
  try {
    const { data } = await api.get(`/config/remote-models?provider=${browseProvider.value}`)
    orModels.value = data.data
  } catch { toast.error('Pastikan API key / koneksi provider sudah dikonfigurasi') }
  finally { loadingOR.value = false }
}

function openModelForm(m = null) {
  editModelId.value = m?.id || null
  modelForm.value = m
    ? { name: m.name, provider: m.provider || 'openrouter', model_id: m.model_id, type: m.type || 'text', max_tokens: m.max_tokens, temperature: m.temperature, notes: m.notes || '' }
    : { name: '', provider: 'openrouter', model_id: '', type: 'text', max_tokens: 4096, temperature: 0.7, notes: '' }
  showModelForm.value = true
}

function quickAddModel(m) {
  modelForm.value = { name: m.name, provider: browseProvider.value, model_id: m.id, type: 'text', max_tokens: 4096, temperature: 0.7, notes: m.is_free ? 'Model gratis' : '' }
  editModelId.value = null
  showModelForm.value = true
}

async function saveModel() {
  if (!modelForm.value.name || !modelForm.value.model_id) return toast.error('Nama dan Model ID wajib diisi')
  savingModel.value = true
  try {
    if (editModelId.value) {
      await api.put(`/config/models/${editModelId.value}`, modelForm.value)
    } else {
      await api.post('/config/models', modelForm.value)
    }
    await fetchModels()
    showModelForm.value = false
    toast.success('Model disimpan!')
  } catch { toast.error('Gagal menyimpan model') }
  finally { savingModel.value = false }
}

async function setDefault(id) {
  await api.put(`/config/models/${id}/default`)
  await fetchModels()
  toast.success('Default model diperbarui')
}

async function deleteModel(id) {
  if (!confirm('Hapus model ini?')) return
  await api.delete(`/config/models/${id}`)
  await fetchModels()
  toast.success('Model dihapus')
}

async function fetchModels() {
  const { data } = await api.get('/config/models')
  models.value = data.data
}

function openTemplateForm(t = null) {
  editTemplateId.value = t?.id || null
  templateForm.value = t ? { name: t.name, jenis_soal: t.jenis_soal, template: t.template } : { name: '', jenis_soal: 'pg', template: '' }
  showTemplateForm.value = true
}

async function saveTemplate() {
  if (!templateForm.value.name || !templateForm.value.template) return toast.error('Semua field wajib diisi')
  savingTemplate.value = true
  try {
    if (editTemplateId.value) await api.put(`/config/templates/${editTemplateId.value}`, templateForm.value)
    else await api.post('/config/templates', templateForm.value)
    const { data } = await api.get('/config/templates')
    templates.value = data.data
    showTemplateForm.value = false
    toast.success('Template disimpan!')
  } catch { toast.error('Gagal menyimpan template') }
  finally { savingTemplate.value = false }
}

async function deleteTemplate(id) {
  if (!confirm('Hapus template ini?')) return
  await api.delete(`/config/templates/${id}`)
  templates.value = templates.value.filter(t => t.id !== id)
  toast.success('Template dihapus')
}

onMounted(async () => {
  await fetchModels()
  const { data: tmplData } = await api.get('/config/templates')
  templates.value = tmplData.data
})
</script>
