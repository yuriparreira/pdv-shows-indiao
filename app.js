/* PDV Shows · Indião Store — v1
   Offline-first: tudo fica no IndexedDB do aparelho. Nada sai do celular sem o usuário exportar. */
'use strict';

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = v => { if (typeof v === 'number') return v; const s = String(v ?? '').trim().replace(/\s/g, ''); if (!s) return 0; const t = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s; const n = parseFloat(t); return isNaN(n) ? 0 : n; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();
const fmtDT = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const fmtD = d => d ? d.split('-').reverse().join('/') : '';
// data da "noite" do show: antes do meio-dia ainda é a noite de ontem (CORTE_H)
const dataNoite = () => { const d = new Date(Date.now() - 12 * 3600e3); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').toLowerCase().trim();
const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } };
const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
const FORMAS = [
  { id: 'pix', nome: 'Pix', cls: 'pix' }, { id: 'credito', nome: 'Crédito', cls: 'cre' },
  { id: 'debito', nome: 'Débito', cls: 'deb' }, { id: 'dinheiro', nome: 'Dinheiro', cls: 'din' },
  { id: 'outro', nome: 'Outro meio', cls: 'out' }]; // Pix de outro banco, Mercado Pago etc. (fora da InfinitePay)
const FORA_INFINITE = ['dinheiro', 'outro'];
const FORMA = Object.fromEntries(FORMAS.map(f => [f.id, f.nome]));
const MOV_TIPOS = [
  { id: 'bonificacao', nome: 'Bonificação (palco)', dica: 'Indião jogou no show' },
  { id: 'brinde', nome: 'Brinde / cortesia', dica: 'Contratante, equipe, fã' },
  { id: 'avaria', nome: 'Avaria / perda', dica: 'Peça danificada ou perdida' },
  { id: 'uso_equipe', nome: 'Retirada da equipe', dica: 'Uso da banda ou da equipe' }];
const MOV = Object.fromEntries(MOV_TIPOS.map(t => [t.id, t.nome]));

// ---------- IndexedDB ----------
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const extra = new URLSearchParams(location.search).get('db');
      const r = indexedDB.open('pdv-shows-indiao' + (extra ? '-' + extra.replace(/\W/g, '') : ''), 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('produtos', { keyPath: 'sku' });
        d.createObjectStore('lotes', { keyPath: 'id' });
        d.createObjectStore('vendas', { keyPath: 'id' });
        d.createObjectStore('movs', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'k' });
      };
      r.onsuccess = () => { DB.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = DB.db.transaction(store, mode); const s = t.objectStore(store); const out = fn(s);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error);
    });
  },
  all(store) { return DB.tx(store, 'readonly', s => s.getAll()); },
  put(store, obj, remoto) { if (!remoto) Sinc.marcar(store, obj); return DB.tx(store, 'readwrite', s => { s.put(obj); }); },
  bulk(store, arr, remoto) { if (!remoto) arr.forEach(o => Sinc.marcar(store, o)); return DB.tx(store, 'readwrite', s => { arr.forEach(o => s.put(o)); }); },
  del(store, key) { return DB.tx(store, 'readwrite', s => { s.delete(key); }); },
};

// ---------- sincronização em tempo real (opcional) ----------
// Com internet e URL configurada, cada mudança vai para a planilha Google (Apps Script) e as dos outros
// celulares voltam a cada 15 s. Sem internet, as mudanças ficam pendentes e sobem quando o sinal voltar.
const Sinc = {
  st: { seq: 0, pend: {}, ultimo: null, catVer: '' }, rodando: false, erro: '', timer: null, partes: {}, cont: 0,
  ativo() { return !!(S.cfg.sincUrl && S.cfg.sincChave); },
  marcar(store, obj) {
    let chave = null;
    if (store === 'lotes') chave = 'lote:' + obj.id;
    if (store === 'vendas' || store === 'movs') { obj.atualizado = now(); chave = (store === 'vendas' ? 'venda:' : 'mov:') + obj.id; }
    if (store === 'meta' && obj.k === 'tabela') chave = 'tabela:atual';
    if (store === 'meta' && obj.k === 'custos') chave = 'custos:atual';
    if (store === 'produtos') { chave = 'catalogo:atual'; this.st.catVer = now(); }
    if (!chave) return;
    this.st.pend[chave] = ++this.cont; this.salvar();
    clearTimeout(this.timer); this.timer = setTimeout(() => this.ciclo(), 1500);
  },
  salvar() { if (DB.db) DB.tx('meta', 'readwrite', s => { s.put({ k: 'sinc', v: this.st }); }); },
  nPend() { return Object.keys(this.st.pend).length; },
  registro(chave) {
    const [tipo, id] = [chave.slice(0, chave.indexOf(':')), chave.slice(chave.indexOf(':') + 1)];
    const base = { aparelho: S.cfg.aparelho };
    if (tipo === 'lote') { const o = S.lotes.find(x => x.id === id); return o && [{ ...base, tipo, id, loteId: id, atualizado: o.atualizado || now(), json: JSON.stringify(o) }]; }
    if (tipo === 'venda') { const o = S.vendas.find(x => x.id === id); return o && [{ ...base, tipo, id, loteId: o.loteId, atualizado: o.atualizado || o.ts, json: JSON.stringify(o) }]; }
    if (tipo === 'mov') { const o = S.movs.find(x => x.id === id); return o && [{ ...base, tipo, id, loteId: o.loteId, atualizado: o.atualizado || o.ts, json: JSON.stringify(o) }]; }
    // a célula da planilha aceita 50 mil caracteres: registros grandes vão em partes de 30 mil (folga para o escape do JSON)
    const partes = (tipo, ver, obj) => { const txt = JSON.stringify(obj); const tam = 30000; const n = Math.ceil(txt.length / tam) || 1;
      return Array.from({ length: n }, (_, i) => ({ ...base, tipo, id: 'parte' + i, atualizado: ver, json: JSON.stringify({ ver, i, n, txt: txt.slice(i * tam, (i + 1) * tam) }) })); };
    if (tipo === 'tabela') { const em = S.tabelaInfo?.em || now(); return partes('tabela', em, { v: S.tabela, em, arq: S.tabelaInfo?.arq || '' }); }
    if (tipo === 'custos') { const em = S.custosInfo?.em || now(); return partes('custos', em, { v: S.custos, em, arq: S.custosInfo?.arq || '' }); }
    if (tipo === 'catalogo') return partes('catalogo', this.st.catVer || now(), [...S.produtos.values()].map(({ _rot, ...p }) => p));
    return null;
  },
  async enviar() {
    const chaves = Object.keys(this.st.pend); if (!chaves.length) return;
    const fila = []; chaves.forEach(c => { const r = this.registro(c); if (r) r.forEach(x => fila.push([c, x])); else delete this.st.pend[c]; });
    while (fila.length) {
      const lote = []; let tam = 0;
      while (fila.length && (lote.length < 40) && (tam < 300000 || !lote.length)) { const it = fila.shift(); lote.push(it); tam += it[1].json.length; }
      const marcas = Object.fromEntries(lote.map(([c]) => [c, this.st.pend[c]]));
      const r = await fetch(S.cfg.sincUrl, { method: 'POST', body: JSON.stringify({ chave: S.cfg.sincChave, registros: lote.map(x => x[1]) }) }).then(x => x.json());
      if (!r.ok) throw new Error(r.erro || 'falha no envio');
      Object.entries(marcas).forEach(([c, m]) => { if (this.st.pend[c] === m && !fila.some(([cc]) => cc === c)) delete this.st.pend[c]; });
    }
    this.salvar();
  },
  async receber() {
    let mais = true, mudou = false;
    while (mais) {
      const u = `${S.cfg.sincUrl}?chave=${encodeURIComponent(S.cfg.sincChave)}&desde=${this.st.seq}`;
      const r = await fetch(u).then(x => x.json()); if (!r.ok) throw new Error(r.erro || 'falha ao receber');
      for (const reg of r.registros) { if (reg.aparelho === S.cfg.aparelho) continue;
        try { if (await this.aplicar(reg)) mudou = true; } catch (e) { console.warn('registro ignorado', reg.tipo, reg.id, e.message); } }
      this.st.seq = r.seq; mais = r.mais;
    }
    this.salvar(); return mudou;
  },
  async aplicar(reg) {
    if (!reg.json) return false; const o = JSON.parse(reg.json); const t = reg.tipo;
    // registro em partes: junta as partes da mesma versão e só aplica quando estiverem todas
    let doc = o;
    if (o.txt !== undefined && o.n) {
      const chave = t + '|' + o.ver; const pt = this.partes[chave] ||= []; pt[o.i] = o.txt;
      if (pt.filter(x => x !== undefined).length < o.n) return false;
      doc = JSON.parse(pt.join('')); delete this.partes[chave];
    }
    const lista = t === 'lote' ? S.lotes : t === 'venda' ? S.vendas : t === 'mov' ? S.movs : null;
    if (lista) {
      if (this.st.pend[t + ':' + o.id]) return false; // alteração local ainda não enviada: a local vence e sobe depois
      const i = lista.findIndex(x => x.id === o.id); const loc = lista[i];
      if (loc && String(loc.atualizado || '') >= String(o.atualizado || '')) return false;
      if (t === 'lote' && loc) (loc.shows || []).forEach(s => { if (!(o.shows || []).find(x => x.id === s.id)) (o.shows ||= []).push(s); });
      if (i < 0) lista.push(o); else lista[i] = o;
      await DB.put(t === 'lote' ? 'lotes' : t === 'venda' ? 'vendas' : 'movs', o, true); return true;
    }
    if (t === 'tabela') { if (S.tabelaInfo?.em && S.tabelaInfo.em >= doc.em) return false; S.tabela = doc.v || {}; S.tabelaInfo = { em: doc.em, arq: doc.arq }; await DB.put('meta', { k: 'tabela', v: S.tabela, em: doc.em, arq: doc.arq }, true); return true; }
    if (t === 'custos') { if (S.custosInfo?.em && S.custosInfo.em >= doc.em) return false; S.custos = doc.v || {}; S.custosInfo = { em: doc.em, arq: doc.arq }; await DB.put('meta', { k: 'custos', v: S.custos, em: doc.em, arq: doc.arq }, true); return true; }
    if (t === 'catalogo') {
      // só recusa se este aparelho já tem um catálogo completo mais novo (produtos criados pela carga não contam)
      if (this.st.catFull && this.st.catVer && this.st.catVer >= o.ver) return false;
      const ps = Array.isArray(doc) ? doc : []; ps.forEach(p => S.produtos.set(p.sku, { ...(S.produtos.get(p.sku) || {}), ...p })); await DB.bulk('produtos', ps, true);
      this.st.catVer = o.ver; this.st.catFull = true; S.cfg.catalogoEm = o.ver; saveCfg(); return true;
    }
    return false;
  },
  async ciclo(forcar) {
    if (!this.ativo() || this.rodando || (!navigator.onLine && !forcar)) return;
    this.rodando = true;
    try { await this.enviar(); const mudou = await this.receber(); this.erro = ''; this.st.ultimo = now(); this.salvar();
      // não redesenha no meio de uma digitação ou com uma folha aberta
      if (mudou && !S.sheet && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) render(); else atualizarSelo();
    } catch (e) { this.erro = e.message || 'sem conexão'; atualizarSelo(); }
    finally { this.rodando = false; }
  },
  selo() {
    if (!this.ativo()) return navigator.onLine ? ['on', '● online'] : ['off', '● offline'];
    const n = this.nPend();
    if (!navigator.onLine) return ['off', `● offline${n ? ' · ' + n + ' pend.' : ''}`];
    if (this.erro) return ['off', '● erro sinc.'];
    return n ? ['off', `● sinc. ${n} pend.`] : ['on', '● sincronizado'];
  },
};
const seloHTML = t => t.replace(/^● /, '●<span class="txt"> ') + '</span>';
function atualizarSelo() { const el = document.querySelector('.net[data-v=config]'); if (!el) return; const [c, t] = Sinc.selo(); el.className = 'net ' + c; el.innerHTML = seloHTML(t); }

// ---------- estado ----------
const S = {
  produtos: new Map(), lotes: [], vendas: [], movs: [], custos: {}, cfg: { vendedor: '', caixa: '', tema: 'dark', aparelho: '', cfopBonif: '5.910 / 6.910', cfopPerda: '5.927',
    taxas: { debito: 1.37, c1: 3.14, c2: 5.38, c3: 6.12, c4: 6.86, c5: 7.60, c6: 8.34 }, das: 0, comissaoPct: 0 }, tabela: {}, miniaturas: { skus: {} },
  view: 'home', loteId: null, tab: 'vender', busca: '', cat: '', todoCatalogo: false, esgotados: false,
  cart: [], cartDesc: 0, cartDescMotivo: '', pagamentos: [], sheet: null, contagemRevelada: false, infinite: null,
};
const lote = () => S.lotes.find(l => l.id === S.loteId);
const saveCfg = () => DB.put('meta', { k: 'cfg', v: S.cfg });
// Perfis. Vendedor: vender, bonificar e contar. Gestor (PIN): lotes, carga, catálogo, financeiro, margem, relatórios e configurações.
// O PIN fica só como hash no aparelho e vai no pacote de configuração. Sem PIN definido, o app fica em modo gestor.
// Controle operacional (não substitui senha de servidor: quem tiver o celular e souber mexer no navegador consegue contornar).
const Perfil = { ate: 0 };
const gestor = () => !S.cfg.pinHash || Date.now() < Perfil.ate;
async function hashPin(pin) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('indiao-pdv:' + pin)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function entrarGestor() {
  const pin = await perguntar({ titulo: 'Entrar como gestor', texto: 'Funções de gestor: lotes, carga, catálogo, financeiro, margem, relatórios e configurações.', tipo: 'pin', ph: 'PIN do gestor', obrig: true, ok: 'Entrar' });
  S.sheet = null; if (!pin) { render(); return false; }
  if (await hashPin(pin) !== S.cfg.pinHash) { render(); toast('PIN incorreto', null, true); return false; }
  Perfil.ate = Date.now() + 15 * 60e3; render(); toast('Modo gestor (sai sozinho após 15 min parado)'); return true;
}
const ABAS_VENDEDOR = ['vender', 'movs', 'contagem'];
const SO_GESTOR = new Set(['importarCaixa', 'destravar', 'fecharLote', 'corrigirData', 'precoItem', 'reabrirFin', 'concluirFin', 'enviarConfig', 'backupTudo', 'sincAgora',
  'novaDesp', 'rmDesp', 'novoAjuste', 'rmAjuste', 'addOutro', 'rmOutro', 'csvTiny', 'tinyCsv', 'pdf', 'cancelarVenda', 'cancelarMov', 'contarCarga', 'precoModelo', 'baixarFotos', 'ajusteDeTx']);
const precisaGestor = el => { const a = el.dataset.a; return SO_GESTOR.has(a) || (a === 'ir' && el.dataset.v === 'catalogo') || (a === 'tab' && !ABAS_VENDEDOR.includes(el.dataset.t)); };
const saveLote = l => { l.atualizado = now(); return DB.put('lotes', l); };

// ---------- catálogo ----------
function modeloDe(p) { return p.pai || (p.sku.includes('-') ? p.sku.split('-')[0] : p.sku); }
function nomeModelo(p) {
  // tira o tamanho/cor do fim da descrição do Tiny ("... - P - Ocre")
  let d = p.descricao || p.sku; const v = p.var || {};
  Object.values(v).forEach(x => { if (x) d = d.replace(new RegExp('\\s*-\\s*' + x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), ' '); });
  return d.replace(/\s+-\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}
function parseVar(s, sku) {
  const out = {};
  String(s || '').split('||').forEach(p => { const [k, v] = p.split(':'); if (k && v) out[norm(k).startsWith('tam') ? 'Tamanho' : (norm(k).startsWith('cor') ? 'Cor' : k.trim())] = v.trim(); });
  if (!Object.keys(out).length && sku && sku.includes('-')) {
    const parts = sku.split('-').slice(1); const tam = parts.find(x => /^(PP|P|M|G|GG|XG|XGG|EG|U|UN|\d{2})$/i.test(x));
    if (tam) out.Tamanho = tam; const cor = parts.filter(x => x !== tam).join(' '); if (cor) out.Cor = cor;
  }
  return out;
}
const TAM_ORD = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'EG', 'U', 'UN'];
const tamIdx = t => { const i = TAM_ORD.indexOf(String(t || '').toUpperCase()); return i < 0 ? 50 + (parseInt(t) || 0) : i; };

// lê planilha (xls/xlsx/csv) e devolve linhas como objetos com cabeçalhos normalizados
async function lerPlanilha(file) {
  const buf = await file.arrayBuffer();
  if (/\.csv$/i.test(file.name)) { let txt = new TextDecoder('utf-8').decode(buf); if (txt.includes('\uFFFD')) txt = new TextDecoder('windows-1252').decode(buf); return csvParse(txt); }
  if (!window.XLSX) {
    throw new Error('Leitor de planilha não carregou. Conecte à internet uma vez para o app guardar o leitor, ou use CSV.');
  }
  const wb = XLSX.read(buf, { type: 'array', codepage: 1252 });
  return wb.SheetNames.map(n => ({ nome: n, linhas: XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: true }) }));
}
function csvParse(txt) {
  txt = txt.replace(/^\uFEFF/, ''); const l1 = txt.slice(0, txt.indexOf('\n'));
  const sep = (l1.match(/;/g) || []).length > (l1.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cel = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { cel += '"'; i++; } else q = false; } else cel += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cel); cel = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(cel); cel = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cel += c;
  }
  row.push(cel); if (row.some(x => x !== '')) rows.push(row);
  const h = rows.shift() || []; return [{ nome: 'csv', linhas: rows.map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? '']))) }];
}
// acha a coluna por pedaços do nome (tolerante a acento quebrado do Tiny)
function col(row, ...tests) {
  const keys = Object.keys(row);
  for (const t of tests) { const k = keys.find(k => t(norm(k))); if (k) return k; }
  return null;
}
function mapear(linhas) {
  const r = linhas[0] || {};
  return {
    sku: col(r, k => k.includes('sku'), k => k === 'codigo' || k === 'cdigo'),
    id: col(r, k => k === 'id produto', k => k === 'id'),
    pedido: col(r, k => k.includes('numero do pedido') || k.includes('mero do pedido')),
    vunit: col(r, k => k.startsWith('valor unit')),
    desc: col(r, k => k.startsWith('descri') && !k.includes('complementar') && !k.includes('seo')),
    preco: col(r, k => /^pre.?o$/.test(k) || k === 'preco' || k === 'preo' || k === 'valor unitario'),
    promo: col(r, k => k.includes('promocional')),
    custo: col(r, k => k.includes('custo')),
    img: col(r, k => k === 'url imagem 1', k => k === 'url imagem externa 1'),
    pai: col(r, k => k.includes('do pai')),
    vari: col(r, k => k.startsWith('varia')),
    cat: col(r, k => k === 'categoria'),
    sit: col(r, k => k.startsWith('situa')),
    ini: col(r, k => k.includes('estoque inicial'), k => k.startsWith('quantidade') || k === 'qtd' || k === 'qtde'),
    bon: col(r, k => k.startsWith('bonifica')),
    fin: col(r, k => k.includes('estoque final')),
  };
}
async function importarCatalogo(file) {
  const abas = await lerPlanilha(file); let n = 0, novos = 0;
  for (const aba of abas) {
    const L = aba.linhas; if (!L.length) continue; const m = mapear(L); if (!m.sku || !m.desc) continue;
    const lista = [];
    for (const r of L) {
      const sku = String(r[m.sku] || '').trim(); if (!sku) continue;
      if (m.sit && norm(r[m.sit]) && !norm(r[m.sit]).startsWith('ativo')) continue;
      const velho = S.produtos.get(sku);
      const vari = parseVar(m.vari ? r[m.vari] : '', sku);
      const p = {
        ...(velho || {}), sku, id: m.id ? String(r[m.id]) : (velho?.id || ''), descricao: String(r[m.desc] || '').trim(),
        preco: m.preco ? num(r[m.preco]) : (velho?.preco || 0), promo: m.promo ? num(r[m.promo]) : (velho?.promo || 0), custo: m.custo ? num(r[m.custo]) : (velho?.custo || 0),
        img: (m.img && r[m.img]) ? String(r[m.img]).trim() : (velho?.img || ''), pai: m.pai ? String(r[m.pai] || '').trim() : (velho?.pai || ''),
        var: Object.keys(vari).length ? vari : (velho?.var || {}), cat: m.cat ? String(r[m.cat] || '').trim() : (velho?.cat || ''),
      };
      if (!p.pai && !Object.keys(p.var).length && !m.pai) p.pai = ''; // produto simples
      if (!velho) novos++; S.produtos.set(sku, p); lista.push(p); n++;
    }
    await DB.bulk('produtos', lista);
  }
  S.cfg.catalogoEm = now(); saveCfg(); Sinc.st.catFull = true; Sinc.salvar();
  return { n, novos };
}
async function importarCarga(file, l) {
  const abas = await lerPlanilha(file); const carga = {}; const lista = []; let linhas = 0;
  const aba = abas.find(a => a.linhas.length && mapear(a.linhas).sku && mapear(a.linhas).ini) || null;
  if (!aba) throw new Error('Não achei as colunas de SKU e quantidade (ex.: "Código (SKU)" e "Estoque Inicial" ou "Quantidade").');
  const m = mapear(aba.linhas); let linhasArq = aba.linhas;
  if (m.pedido) { // exportação de pedidos do Tiny: pode vir mais de um pedido no arquivo
    const nums = [...new Set(linhasArq.map(r => String(r[m.pedido]).trim()).filter(Boolean))];
    let alvo = nums.length === 1 ? nums[0] : (nums.includes(String(l.pedido)) ? String(l.pedido) : null);
    if (!alvo) { alvo = await perguntar({ titulo: 'Qual pedido é deste lote?', texto: `O arquivo tem ${nums.length} pedidos.`, chips: nums.slice(0, 12), ok: 'Usar', obrig: true }); S.sheet = null; if (!alvo) throw new Error('Importação cancelada'); }
    linhasArq = linhasArq.filter(r => String(r[m.pedido]).trim() === String(alvo).trim());
    if (!l.pedido) l.pedido = String(alvo).trim();
    const c0 = linhasArq[0] || {}; const pega = (...t) => { const k = col(c0, ...t); return k ? String(c0[k]) : ''; };
    l.contatoTiny = { nome: pega(k => k === 'nome do contato' || k === 'nome do contato*'), tipo: pega(k => k === 'tipo de pessoa'), doc: pega(k => k === 'cpf/cnpj'), ie: pega(k => k === 'rg/ie'),
      cep: pega(k => k === 'cep'), mun: pega(k => k.startsWith('munic') && !k.includes('entrega')), uf: pega(k => k === 'uf'), end: pega(k => k.startsWith('endere') && !k.includes('nro') && !k.includes('entrega')),
      nro: pega(k => k.startsWith('endere') && k.includes('nro') && !k.includes('entrega')), compl: pega(k => k === 'complemento'), bairro: pega(k => k === 'bairro') };
  }
  l.precos = {};
  for (const r of linhasArq) {
    const sku = skuFisico(String(r[m.sku] || '').trim()); const q = num(r[m.ini]); if (!sku || q <= 0) continue;
    carga[sku] = (carga[sku] || 0) + q; linhas++;
    if (m.vunit && num(r[m.vunit]) > 0) l.precos[sku] = num(r[m.vunit]);
    if (!S.produtos.has(sku)) {
      const p = { sku, id: m.id ? String(r[m.id]) : '', descricao: m.desc ? String(r[m.desc]).trim() : sku, preco: 0, promo: 0, img: '', pai: '', var: parseVar('', sku), cat: '' };
      S.produtos.set(sku, p); lista.push(p);
    }
  }
  if (lista.length) await DB.bulk('produtos', lista, true); // provisórios: não sobem nem substituem o catálogo da planilha
  await aplicarCarga(l, carga, file.name);
  return { linhas, pecas: Object.values(carga).reduce((a, b) => a + b, 0), semCadastro: lista.length };
}
async function aplicarCarga(l, carga, nome) { l.carga = carga; l.cargaArquivo = nome; l.cargaEm = now(); l.cargaPor = `${S.cfg.vendedor || '?'}${gestor() ? '' : ' (vendedor)'}`; await saveLote(l); }

// ---------- carga a partir do PDF do pedido (ou da nota) do Tiny ----------
let pdfjsPronto;
function carregarPdfJs() {
  return pdfjsPronto ||= new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    sc.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; res(); };
    sc.onerror = () => { pdfjsPronto = null; rej(new Error('Leitor de PDF não carregou. Abra o app uma vez com internet.')); };
    document.head.appendChild(sc);
  });
}
async function textoDoPdf(file) {
  await carregarPdfJs();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; let t = '';
  for (let i = 1; i <= doc.numPages; i++) { const c = await (await doc.getPage(i)).getTextContent(); t += c.items.map(x => x.str + (x.hasEOL ? '\n' : ' ')).join('') + '\n'; }
  return t;
}
// O PDF quebra o SKU em linhas ("BWXI2-Bege+Mari / nho"). Procura cada SKU do catálogo no texto sem espaços,
// do mais longo para o mais curto, e pega a primeira quantidade (número com vírgula) depois dele.
function cargaDoTexto(t) {
  let comp = ''; const pos = [];
  for (let i = 0; i < t.length; i++) if (!/\s/.test(t[i])) { comp += t[i]; pos.push(i); }
  const usado = new Uint8Array(comp.length); const carga = {}; const achados = [];
  const skus = [...S.produtos.keys()].map(k => [k, k.replace(/\s+/g, '')]).filter(([, c]) => c.length >= 4).sort((a, b) => b[1].length - a[1].length);
  for (const [sku, c] of skus) {
    let i = comp.indexOf(c);
    while (i >= 0) {
      let livre = true; for (let j = i; j < i + c.length; j++) if (usado[j]) { livre = false; break; }
      // SKU inteiro: espaço (ou início/fim) antes e depois, para "BWXI2-Preto" não casar dentro de "BWXI2-Preto+Laranja"
      const antes = t[pos[i] - 1], depois = t[pos[i + c.length - 1] + 1];
      if (livre && (antes === undefined || /\s/.test(antes)) && (depois === undefined || /\s/.test(depois))) {
        usado.fill(1, i, i + c.length);
        const fim = pos[i + c.length - 1] + 1; const resto = t.slice(fim, fim + 400);
        const m = resto.match(/(?:^|\s)(\d{1,5}(?:\.\d{3})*,\d{2,4})(?=\s|$)/);
        const q = m ? Math.round(num(m[1])) : 0;
        if (q > 0) { carga[skuFisico(sku)] = (carga[skuFisico(sku)] || 0) + q; achados.push({ sku, q }); }
      }
      i = comp.indexOf(c, i + 1);
    }
  }
  const linhasNota = (t.match(/\b\d{8}\s+\d{3,4}\s+\d\.\d{3}\b/g) || []).length; // linhas de item de DANFE (NCM CST CFOP)
  return { carga, achados, linhasNota };
}
async function lerCargaPdf(file, l) {
  if (!S.produtos.size) throw new Error('Importe antes o catálogo do Tiny: o app reconhece os itens do PDF pelo SKU do catálogo.');
  const t = await textoDoPdf(file); const r = cargaDoTexto(t);
  if (!r.achados.length) throw new Error('Não reconheci nenhum SKU do catálogo neste PDF. Confira se o catálogo está atualizado.');
  const pedido = (t.match(/pedido\s*(?:de venda)?\s*(?:n[º°o.]*)?\s*[:#]?\s*(\d{3,})/i) || [])[1];
  S.sheet = { k: 'cargaPrev', carga: r.carga, nome: file.name, achados: r.achados.length, linhasNota: r.linhasNota, pedido }; renderSheet();
}
// Preço de venda = tabela "Shows e Eventos". Ordem: preço do pedido do lote (vem da tabela no Tiny) >
// tabela importada > preço de show digitado no modelo > preço do ERP (último recurso, marcado como "ERP").
function fontePreco(p) {
  if (S.loteId && lote()?.precos?.[p.sku]) return ['pedido', lote().precos[p.sku]];
  if (S.tabela[p.sku]) return ['tabela', S.tabela[p.sku]];
  if (p.pai && S.tabela[p.pai]) return ['tabela', S.tabela[p.pai]];
  if (p.precoShow) return ['manual', p.precoShow];
  return ['erp', p.preco || 0];
}
const precoShow = p => fontePreco(p)[1];
// Custo oficial = aba 12.1.Custos da modelagem (gerado por custos/gerar_custos_oficiais.py). Vale antes do custo do Tiny.
// SKU -fem sem custo próprio usa o da versão masculina (política da aba 00.5).
// alíquota efetiva do Simples (Anexo I, 3ª faixa) da modelagem v9.7, aba 15.Tributario: set/26 realizado 7,10%; out/26 projetado 7,02%
const DAS_MODELAGEM = { pct: 7.02, ref: 'out/26', fonte: 'modelagem v9.7 · 15.Tributario' };
// SKU "-fem" é variação comercial do site: no Tiny é um kit de 1 unidade do original (mesmo estoque, mesmo custo).
// No app ele vira sempre o SKU físico original, na carga, na venda, na bonificação, na contagem e no custo.
// Quando a cor vem abreviada (CIXW4-Azul-M-fem x CIXW4-Azul Indigo-M), acha o original do mesmo modelo e tamanho cuja cor começa igual.
function skuFisico(sku) {
  sku = String(sku || ''); if (!/-fem$/i.test(sku)) return sku;
  const base = sku.replace(/-fem$/i, ''); if (S.produtos.has(base) || S.custos[base]) return base;
  const pt = base.split('-'); if (pt.length < 3) return base;
  const modelo = pt[0], tam = pt[pt.length - 1], cor = pt.slice(1, -1).join('-').toLowerCase();
  const cand = [...new Set([...S.produtos.keys(), ...Object.keys(S.custos)])].filter(x => !/-fem$/i.test(x) && x.split('-')[0] === modelo && x.split('-').pop() === tam && x.split('-').slice(1, -1).join('-').toLowerCase().startsWith(cor));
  return cand.length === 1 ? cand[0] : base;
}
function custoDe(sku) {
  if (/-fem$/i.test(sku)) return custoDe(skuFisico(sku));
  return S.custos[sku]?.c || S.produtos.get(sku)?.custo || 0;
}
async function importarCustos(file) {
  const abas = await lerPlanilha(file); const t = {}; let n = 0;
  for (const aba of abas) { const L = aba.linhas; if (!L.length) continue; const m = mapear(L); if (!m.sku || !m.custo) continue;
    const cf = col(L[0], k => k === 'fonte'); const cb = col(L[0], k => k === 'base');
    L.forEach(r => { const sku = String(r[m.sku] || '').trim(); const c = num(r[m.custo]); if (sku && c > 0) { t[sku] = { c, f: cf ? String(r[cf]) : '', b: cb ? String(r[cb]) : '' }; n++; } }); }
  if (!n) throw new Error('Não achei as colunas de SKU e custo no arquivo.');
  S.custos = t; S.custosInfo = { em: now(), arq: file.name }; await DB.put('meta', { k: 'custos', v: t, em: S.custosInfo.em, arq: file.name });
  return n;
}
async function importarTabela(file) {
  const abas = await lerPlanilha(file); let n = 0; const t = {};
  for (const aba of abas) { const L = aba.linhas; if (!L.length) continue; const m = mapear(L);
    const cp = m.vunit || m.preco || col(L[0], k => k.includes('preco') && !k.includes('custo') && !k.includes('promo'), k => k.startsWith('valor'));
    if (!m.sku || !cp) continue;
    L.forEach(r => { const sku = String(r[m.sku] || '').trim(); const v = num(r[cp]); if (sku && v > 0) { t[sku] = v; n++; } }); }
  if (!n) throw new Error('Não achei as colunas de SKU e preço na tabela.');
  S.tabela = t; await DB.put('meta', { k: 'tabela', v: t, em: now(), arq: file.name }); S.tabelaInfo = { em: now(), arq: file.name };
  return n;
}

// ---------- cálculos do lote ----------
const vendasLote = (l, incluirCanc) => S.vendas.filter(v => v.loteId === l.id && (incluirCanc || v.status !== 'cancelada'));
const movsLote = l => S.movs.filter(m => m.loteId === l.id && m.status !== 'cancelada');
function saldos(l) {
  const r = {}; const g = sku => (r[sku] ||= { carga: 0, vendido: 0, mov: 0, movTipo: {}, valor: 0 });
  Object.entries(l.carga || {}).forEach(([s, q]) => g(s).carga += q);
  vendasLote(l).forEach(v => { const t = totalVenda(v); const f = t.bruto ? t.liq / t.bruto : 1; // desconto rateado pelos itens
    v.itens.forEach(i => { g(i.sku).vendido += i.qtd; g(i.sku).valor += i.qtd * i.preco * f; }); });
  movsLote(l).forEach(m => { const x = g(m.sku); x.mov += m.qtd; x.movTipo[m.tipo] = (x.movTipo[m.tipo] || 0) + m.qtd; });
  Object.values(r).forEach(x => x.saldo = x.carga - x.vendido - x.mov);
  return r;
}
function totalVenda(v) { const b = v.itens.reduce((a, i) => a + i.qtd * i.preco, 0); return { bruto: b, liq: b - (v.desconto || 0) }; }
function resumo(l, showId) {
  const vs = vendasLote(l).filter(v => !showId || v.showId === showId);
  const o = { n: vs.length, pecas: 0, bruto: 0, desc: 0, liq: 0, formas: {}, canc: vendasLote(l, true).filter(v => v.status === 'cancelada' && (!showId || v.showId === showId)).length };
  vs.forEach(v => { const t = totalVenda(v); o.bruto += t.bruto; o.desc += v.desconto || 0; o.liq += t.liq; v.itens.forEach(i => o.pecas += i.qtd); v.pagamentos.forEach(p => o.formas[p.forma] = (o.formas[p.forma] || 0) + p.valor); });
  o.ticket = o.n ? o.liq / o.n : 0; return o;
}
const showAtual = l => (l.shows || []).find(s => s.id === l.showAtual) || (l.shows || [])[l.shows.length - 1];

// ---------- render ----------
function render() {
  document.documentElement.dataset.theme = S.cfg.tema === 'light' ? 'light' : 'dark';
  const app = $('#app');
  const v = S.view;
  if (!gestor() && v === 'catalogo') S.view = 'home';
  if (S.view === 'lote' && !gestor() && !ABAS_VENDEDOR.includes(S.tab)) S.tab = 'vender';
  if (S.view === 'home') app.innerHTML = vHome();
  else if (S.view === 'novo') app.innerHTML = vNovo();
  else if (S.view === 'catalogo') app.innerHTML = vCatalogo();
  else if (S.view === 'config') app.innerHTML = vConfig();
  else if (S.view === 'lote') app.innerHTML = vLote();
  renderSheet();
}
function topo(titulo, sub, voltar, extra = '') {
  return `<header class="top">${voltar ? `<button class="iconbtn" data-a="voltar" aria-label="Voltar">‹</button>` : ''}
  ${titulo === null ? `<img class="logo" src="marca/logo-negativo.svg" alt="Indião Store"><h1><span class="sub">${esc(sub)}</span></h1>` : `<h1>${esc(titulo)}${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</h1>`}${extra}
  ${S.cfg.pinHash ? `<button class="net ${gestor() ? 'on' : ''}" data-a="perfil" aria-label="Trocar perfil">${gestor() ? '🔓<span class="txt"> gestor</span>' : '👤<span class="txt"> vendedor</span>'}</button>` : ''}
  <span class="net ${Sinc.selo()[0]}" data-a="ir" data-v="config">${seloHTML(Sinc.selo()[1])}</span></header><div class="faixa"></div>`;
}
function vHome() {
  const lotes = [...S.lotes].sort((a, b) => (b.criado || '').localeCompare(a.criado || ''));
  const semCfg = !S.cfg.vendedor;
  return topo(null, 'PDV Shows', false, `<button class="iconbtn" data-a="ir" data-v="config" aria-label="Configurações">⚙</button>`) + `<main>
  ${semCfg ? `<div class="warn">Antes do primeiro show: em ⚙ informe seu nome e o nome deste caixa.</div>` : ''}
  ${!S.cfg.pinHash ? `<div class="warn">Sem PIN de gestor: qualquer pessoa acessa tudo. Defina o PIN em ⚙ para o modo vendedor (só venda, bonificação e contagem).</div>` : ''}
  <button class="btn primary block" data-a="ir" data-v="novo" style="margin-bottom:12px">+ Novo lote de show</button>
  ${gestor() ? `<div class="grid2" style="margin-bottom:16px">
    <button class="btn" data-a="ir" data-v="catalogo">Catálogo (${S.produtos.size})</button>
    <button class="btn" data-a="importarCaixa">Receber arquivo</button>
  </div>` : `<p class="muted small">Modo vendedor: crie o lote ou abra o do show. Catálogo e recebimento de arquivos são do gestor.</p>`}
  ${lotes.length ? lotes.map(l => { const r = resumo(l); const sh = l.shows || [];
    return `<button class="card" style="width:100%;text-align:left" data-a="abrirLote" data-id="${l.id}">
      <div class="row"><b class="grow">${l.pedido ? 'Pedido ' + esc(l.pedido) : 'Lote sem pedido'}</b><span class="pill ${l.status}">${l.status}</span></div>
      <div class="muted small" style="margin:4px 0 8px">${sh.map(s => esc(s.cidade) + '/' + s.uf).join(' · ') || 'sem show cadastrado'}</div>
      <div class="row"><span class="grow">${r.n} vendas · ${r.pecas} peças</span><b>${brl(r.liq)}</b></div></button>`; }).join('')
    : `<div class="empty">Nenhum lote ainda.<br>Crie um lote para cada pedido "Shows e Eventos" tirado no Tiny.</div>`}
  </main>`;
}
function vNovo() {
  return topo('Novo lote', 'Um lote = um pedido de retirada no Tiny', true) + `<main><form data-f="novoLote">
  <label class="f">Nº do pedido no Tiny (cliente "Shows e Eventos")<input class="i" name="pedido" inputmode="numeric" placeholder="ex.: 4821"></label>
  <label class="f">Responsável pela carga<input class="i" name="resp" value="${esc(S.cfg.vendedor)}" required></label>
  <label class="f">Equipe de venda<input class="i" name="equipe" placeholder="ex.: nomes da equipe do show"></label>
  <div id="shows">${blocoShow(1, dataNoite())}</div>
  <p class="muted small">A data do show é a da noite em que ele começou. Show que começa depois da meia-noite usa a data da véspera.</p>
  <button type="button" class="btn block" data-a="maisShow" style="margin-bottom:12px">+ Adicionar outro show deste lote</button>
  <button class="btn primary block">Criar lote</button>
  <p class="muted small">Depois de criar, importe a carga (planilha do pedido ou o modelo "Vendas em Shows") ou conte a carga no app.</p>
  </form></main>`;
}
function blocoShow(n, data, uf = '') {
  return `<div class="card showbloco"><h2>Show ${n}</h2>${n > 1 ? '<button type="button" class="iconbtn rm" data-a="rmShow" aria-label="Remover show">✕</button>' : ''}
    <label class="f">Cidade<input class="i" name="cidade" required autocomplete="off"></label>
    <div class="grid2"><label class="f">UF<select class="i" name="uf" required><option value="">--</option>${UFS.map(u => `<option ${u === uf ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
    <label class="f">Data<input class="i" type="date" name="data" value="${data}" required></label></div>
    <label class="f">Evento / local (opcional)<input class="i" name="evento" placeholder="ex.: Rodeio de Arapongas"></label></div>`;
}
function vConfig() {
  return topo('Configurações', '', true) + `<main><form data-f="cfg">
  <label class="f">Seu nome (vendedor)<input class="i" name="vendedor" value="${esc(S.cfg.vendedor)}" required></label>
  <label class="f">Nome deste caixa / aparelho<input class="i" name="caixa" value="${esc(S.cfg.caixa)}" placeholder="ex.: Caixa 1 · Maquininha 6368" required></label>
  <label class="f">Tema<select class="i" name="tema"><option value="dark" ${S.cfg.tema !== 'light' ? 'selected' : ''}>Escuro (show à noite)</option><option value="light" ${S.cfg.tema === 'light' ? 'selected' : ''}>Claro (sol forte)</option></select></label>
  ${!gestor() ? `<button class="btn primary block">Salvar</button></form><div class="card" style="margin-top:16px"><h2>Perfil</h2><p class="muted small">Modo vendedor: vender, lançar bonificação e contar. O restante é do gestor.</p><button class="btn block" data-a="perfil">Entrar como gestor</button></div></main>` : `
  <div class="card"><h2>PIN do gestor</h2><p class="muted small">${S.cfg.pinHash ? 'PIN definido. Para trocar, digite um novo.' : 'Sem PIN, qualquer pessoa acessa tudo.'} Com PIN, o app abre em modo vendedor (venda, bonificação e contagem) e o gestor entra pelo selo "👤 vendedor" no topo. O PIN vai junto no "Enviar configuração".</p>
  <div class="grid2"><label class="f">Novo PIN (4 a 8 números)<input class="i" name="pinNovo" type="password" inputmode="numeric" autocomplete="off"></label><label class="f">Repetir PIN<input class="i" name="pinConf" type="password" inputmode="numeric" autocomplete="off"></label></div></div>
  <div class="card"><h2>Notas à parte (relatório)</h2>
  <label class="f">CFOP da bonificação<input class="i" name="cfopBonif" value="${esc(S.cfg.cfopBonif)}"></label>
  <label class="f">CFOP da perda de contagem<input class="i" name="cfopPerda" value="${esc(S.cfg.cfopPerda)}"></label></div>
  <div class="card"><h2>Margem por show</h2><p class="muted small">Alíquota efetiva do DAS (Simples Nacional), tratada como dedução da receita como na modelagem financeira. Comissão padrão é sugerida ao lançar a despesa.</p>
  ${S.cfg.dasRef ? `<p class="small muted">Referência atual: ${esc(S.cfg.dasRef)}. Atualize todo mês depois do PGDAS-D (rotina em custos/ROTINA-CUSTOS.md).</p>` : ''}
  <div class="grid2"><label class="f">DAS efetivo (%)<input class="i" name="das" inputmode="decimal" value="${String(S.cfg.das || 0).replace('.', ',')}"></label>
  <label class="f">Comissão padrão (%)<input class="i" name="comissaoPct" inputmode="decimal" value="${String(S.cfg.comissaoPct || 0).replace('.', ',')}"></label></div></div>
  <div class="card"><h2>Taxas estimadas da InfinitePay (%)</h2><p class="muted small">Usadas antes de importar o extrato. Débito, crédito à vista, 2x e 3x vêm do extrato de out/26; 4x a 6x são estimativa: confirme no app da InfinitePay.</p>
  <div class="grid2">${[['debito', 'Débito'], ['c1', 'Crédito 1x'], ['c2', 'Crédito 2x'], ['c3', 'Crédito 3x'], ['c4', 'Crédito 4x'], ['c5', 'Crédito 5x'], ['c6', 'Crédito 6x']].map(([k, n]) => `<label class="f">${n}<input class="i" name="tx_${k}" inputmode="decimal" value="${String(S.cfg.taxas[k]).replace('.', ',')}"></label>`).join('')}</div></div>
  <div class="card"><h2>Sincronização em tempo real</h2>
  <p class="muted small">Com internet, cada venda, bonificação, lote, tabela e catálogo vai para a planilha da Indião, e as dos outros celulares chegam aqui a cada 15 s. Sem sinal, fica pendente e sobe quando voltar. Deixe em branco para usar só no aparelho.</p>
  <label class="f">URL do servidor (Apps Script)<input class="i" name="sincUrl" value="${esc(S.cfg.sincUrl || '')}" placeholder="https://script.google.com/macros/s/…/exec" inputmode="url"></label>
  <label class="f">Chave<input class="i" name="sincChave" value="${esc(S.cfg.sincChave || '')}" autocomplete="off"></label>
  <p class="small ${Sinc.erro ? 'neg' : 'muted'}">${Sinc.ativo() ? (Sinc.erro ? 'Erro: ' + esc(Sinc.erro) : `Última sincronização: ${Sinc.st.ultimo ? fmtDT(Sinc.st.ultimo) : 'ainda não'} · ${Sinc.nPend()} pendentes`) : 'Desligada.'}</p>
  ${Sinc.ativo() ? '<button type="button" class="btn block" data-a="sincAgora">Sincronizar agora</button>' : ''}</div>
  <button class="btn primary block">Salvar</button></form>
  <div class="card" style="margin-top:16px"><h2>Configurar outro celular</h2>
  <p class="muted small">Gera um arquivo com o catálogo, a tabela Shows e Eventos, os lotes abertos (pedido, shows e carga) com as vendas, os CFOPs, as taxas e a sincronização. No outro celular: tela inicial › <b>Receber arquivo</b>. Vale também sem internet (WhatsApp, Bluetooth, cabo).</p>
  <button class="btn block" data-a="enviarConfig">Enviar configuração</button></div>
  <div class="card"><h2>Armazenamento</h2><p class="muted small" id="persist">Verificando…</p>
  <button class="btn block" data-a="backupTudo">Baixar backup completo</button></div>
  <p class="muted small">Versão 1.6 · ${Sinc.ativo() ? 'Sincronizando com a planilha da Indião quando houver internet.' : 'Os dados ficam só neste aparelho até você exportar.'}</p></main>`}`;
}
function vCatalogo() {
  const ps = [...S.produtos.values()]; const mods = agrupar(ps);
  return topo('Catálogo', `${ps.length} SKUs · ${mods.length} modelos`, true) + `<main>
  <div class="card"><h2>Atualizar do Tiny</h2>
  <p class="muted small">No Tiny: Cadastros › Produtos › Exportar (planilha). O app lê SKU, descrição, variações, preço e a URL da foto. ${S.cfg.catalogoEm ? 'Última atualização: ' + fmtDT(S.cfg.catalogoEm) : ''}</p>
  <label class="btn primary block">Importar planilha do Tiny<input type="file" accept=".xls,.xlsx,.csv" class="hide" data-in="catalogo"></label>
  <p class="muted small" style="margin-top:10px">Fotos: ${Object.keys(S.miniaturas.skus || {}).length} SKUs com miniatura guardada no app (funcionam offline${S.miniaturas.gerado ? ', geradas em ' + fmtDT(S.miniaturas.gerado) : ''}). Foto nova ou trocada no Tiny entra rodando o script de miniaturas (fotos/ROTINA-FOTOS.md).</p>
  <button class="btn block" data-a="baixarFotos">Guardar fotos do Tiny dos SKUs sem miniatura</button>
  <p class="muted small" id="fotosStatus"></p></div>
  <div class="card"><h2>Custos oficiais (modelagem)</h2>
  <p class="muted small">O CMV, a bonificação, a perda e a margem usam o custo da modelagem financeira (aba 12.1.Custos, base CPC 16). O custo do Tiny só vale para o SKU que não estiver no arquivo. Gerado por <b>custos/gerar_custos_oficiais.py</b>. ${Object.keys(S.custos).length ? `${Object.keys(S.custos).length} SKUs${S.custosInfo ? ' · ' + esc(S.custosInfo.arq) + ' · ' + fmtDT(S.custosInfo.em) : ''}.` : '<b>Nenhum arquivo importado: usando o custo do Tiny.</b>'}</p>
  <label class="btn primary block">Importar custos oficiais<input type="file" accept=".csv,.xls,.xlsx" class="hide" data-in="custos"></label></div>
  <div class="card"><h2>Tabela de preços "Shows e Eventos"</h2>
  <p class="muted small">O preço de venda no show vem desta tabela (ou do pedido do lote), não do preço fixo do ERP. Aceita a exportação da lista de preços do Tiny ou qualquer planilha com SKU e preço. ${Object.keys(S.tabela).length ? `${Object.keys(S.tabela).length} SKUs na tabela${S.tabelaInfo ? ' · ' + esc(S.tabelaInfo.arq) + ' · ' + fmtDT(S.tabelaInfo.em) : ''}.` : '<b>Nenhuma tabela importada.</b>'}</p>
  <label class="btn primary block">Importar tabela Shows e Eventos<input type="file" accept=".csv,.xls,.xlsx" class="hide" data-in="tabela"></label></div>
  <div class="card"><h2>Preço de venda no show, por modelo</h2>
  <p class="muted small">Mostra o preço que o vendedor vai cobrar e de onde ele vem. <b>Tabela</b> = Shows e Eventos; <b>manual</b> = digitado aqui; <b class="neg">ERP</b> = sem preço de show (usa o preço fixo do Tiny). Toque para digitar um preço manual.</p>
  ${(() => { const sem = mods.filter(m => fontePreco(m.skus[0])[0] === 'erp').length; return sem && Object.keys(S.tabela).length ? `<div class="warn">${sem} modelos sem preço na tabela Shows e Eventos (aparecem com ERP).</div>` : ''; })()}
  ${mods.map(m => { const [fonte, pr] = fontePreco(m.skus[0]); return `<div class="line"><div class="grow"><div style="font-weight:600">${esc(m.nome)}</div><div class="muted small">${m.skus.length} SKUs · ERP ${brl(m.preco)}</div></div>
    <button class="btn" style="min-width:120px;flex-direction:column;gap:0" data-a="precoModelo" data-m="${esc(m.id)}">${pr ? brl(pr) : '—'}<small class="${fonte === 'erp' ? 'neg' : 'muted'}" style="font-size:11px">${{ tabela: 'tabela', manual: 'manual', erp: 'ERP', pedido: 'pedido' }[fonte]}</small></button></div>`; }).join('') || '<div class="empty">Importe o catálogo.</div>'}
  </div></main>`;
}
function agrupar(ps) {
  const pais = new Set([...S.produtos.values()].map(p => p.pai).filter(Boolean));
  ps = ps.filter(p => !pais.has(p.sku)); // a linha do produto pai não é vendável; as variações são
  ps = ps.filter(p => !(/-fem$/i.test(p.sku) && S.produtos.has(skuFisico(p.sku)))); // -fem é o mesmo item do original
  const g = new Map();
  ps.forEach(p => { const id = modeloDe(p); if (!g.has(id)) g.set(id, { id, nome: nomeModelo(p), img: '', cat: p.cat, preco: p.preco, precoShow: p.precoShow || 0, skus: [] }); const m = g.get(id); m.skus.push(p); if (!m.img) m.img = fotoDe(p); if (!m.cat && p.cat) m.cat = p.cat; });
  g.forEach(m => { if (!m.img) m.img = fotoDe(S.produtos.get(m.id)) || ''; });
  g.forEach(m => { if (m.skus.length < 2) { m.skus.forEach(p => p._rot = rotulo(p)); return; }
    const ws = m.skus.map(p => (p.descricao || '').split(/\s+/)); let k = 0;
    while (ws.every(w => w[k] !== undefined && w[k] === ws[0][k])) k++;
    const pref = ws[0].slice(0, k).join(' ').replace(/[\s,-]+$/, '');
    if (pref.length >= 6) { m.nome = pref; m.skus.forEach((p, i) => p._rot = ws[i].slice(k).join(' ').replace(/^[\s,-]+/, '') || rotulo(p)); }
    else m.skus.forEach(p => p._rot = rotulo(p)); });
  return [...g.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}
// "Camiseta Algodão Pima com Elastano - Cabeça de Boi" -> ["Camiseta Algodão Pima...", "Cabeça de Boi"]
const curto = n => { const i = n.indexOf(' - '); return i > 0 ? [n.slice(0, i), n.slice(i + 3)] : ['', n]; };
// Miniatura que vai junto com o app (fotos/indice.json, gerado por fotos/gerar_miniaturas.py); sem ela, o link do Tiny.
const fotoDe = p => { if (!p) return ''; const ix = S.miniaturas.skus || {}; const f = ix[p.sku] || ix[p.pai] || ix[skuFisico(p.sku)]; return f ? 'fotos/' + f : (p.img || ''); };
const rotulo = p => [p.var?.Cor, p.var?.Tamanho].filter(Boolean).join(' · ') || p.sku;
function vLote() {
  const l = lote(); if (!l) { S.view = 'home'; return vHome(); }
  const sh = showAtual(l); const fechado = l.status !== 'aberto';
  const tabs = [['vender', 'Vender'], ['vendas', 'Vendas'], ['movs', 'Bonificações'], ['contagem', 'Contagem'], ['financeiro', 'Financeiro'], ['margem', 'Margem'], ['relatorio', 'Relatório']].filter(([k]) => gestor() || ABAS_VENDEDOR.includes(k));
  let body = '';
  if (S.tab === 'vender') body = fechado ? `<div class="warn">${l.status === 'fechado' ? 'Lote fechado. Veja o Relatório.' : 'Vendas travadas para a contagem. Termine a contagem na aba Contagem.'}</div>${l.status === 'contagem' ? '<button class="btn block" data-a="destravar">Destravar vendas (zera a contagem)</button>' : ''}` : tVender(l);
  if (S.tab === 'vendas') body = tVendas(l);
  if (S.tab === 'movs') body = tMovs(l);
  if (S.tab === 'contagem') body = tContagem(l);
  if (S.tab === 'financeiro') body = tFinanceiro(l);
  if (S.tab === 'margem') body = tMargem(l);
  if (S.tab === 'relatorio') body = tRelatorio(l);
  return topo(l.pedido ? 'Pedido ' + l.pedido : 'Lote', sh ? `${sh.cidade}/${sh.uf} · ${fmtD(sh.data)}` : 'sem show', true,
    `<button class="iconbtn" data-a="sheetShow" aria-label="Trocar show">📍</button>`) +
    `<nav class="tabs">${tabs.map(([k, n]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-a="tab" data-t="${k}">${n}</button>`).join('')}</nav>
    ${(S.tab === 'vender' || S.tab === 'vendas') && (l.shows || []).length ? `<div class="showbar">${l.shows.map(s => `<button class="showchip ${sh && sh.id === s.id ? 'on' : ''}" ${l.status === 'aberto' ? `data-a="usarShow" data-id="${s.id}"` : 'disabled'}>${sh && sh.id === s.id ? '📍 ' : ''}<b>${esc(s.cidade)}/${s.uf}</b><small>${fmtD(s.data).slice(0, 5)} · ${resumo(l, s.id).n} vendas</small></button>`).join('')}</div>` : ''}
    <main>${body}</main>${S.tab === 'vender' && !fechado ? cartBar() : ''}`;
}
function tVender(l) {
  if (!Object.keys(l.carga || {}).length) return `<div class="card"><h2>Falta a carga deste lote</h2>
    <p class="muted small">A carga é o que foi retirado do estoque no pedido "Shows e Eventos". A venda só mostra esses itens. Sem carga, o app não controla o saldo.</p>
    <label class="btn primary block">Importar pedido do Tiny (CSV)<input type="file" accept=".csv,.xls,.xlsx" class="hide" data-in="carga"></label>
    <p class="muted small">No Tiny: Vendas › Pedidos de venda › marque o pedido "Shows e Eventos" › Exportar. O app lê SKU, quantidade e o preço de show do pedido.</p>
    <label class="btn block">Importar PDF do pedido ou da nota<input type="file" accept=".pdf,application/pdf" class="hide" data-in="carga"></label>
    <button class="btn block" style="margin-top:10px" data-a="contarCarga">Contar a carga no app${gestor() ? '' : ' (gestor)'}</button></div>`;
  const aviso = alertaData(l);
  const sd = saldos(l); const noCart = {}; S.cart.forEach(c => noCart[c.sku] = (noCart[c.sku] || 0) + c.qtd);
  let ps = [...S.produtos.values()]; if (!S.todoCatalogo) ps = ps.filter(p => sd[p.sku]?.carga);
  const mods = agrupar(ps); const cats = [...new Set(mods.map(m => m.cat).filter(Boolean))].sort();
  const q = norm(S.busca);
  const vis = mods.filter(m => (!S.cat || m.cat === S.cat) && (!q || norm(m.nome + ' ' + m.skus.map(s => s.sku).join(' ')).includes(q)));
  // mais vendidos do lote primeiro
  const vend = m => m.skus.reduce((a, p) => a + (sd[p.sku]?.vendido || 0), 0);
  vis.sort((a, b) => (!precoShow(a.skus[0])) - (!precoShow(b.skus[0])) || vend(b) - vend(a) || a.nome.localeCompare(b.nome));
  const temSaldo = m => m.skus.some(p => (sd[p.sku]?.saldo || 0) > 0);
  const nEsg = vis.filter(m => !temSaldo(m)).length; const lista = (S.esgotados || S.todoCatalogo) ? vis : vis.filter(temSaldo);
  return aviso + `<div class="search"><input class="i" style="width:100%" type="search" placeholder="Buscar modelo ou SKU" value="${esc(S.busca)}" data-in="busca" enterkeyhint="search"></div>
  <div class="chips"><button class="chip ${!S.cat ? 'on' : ''}" data-a="cat" data-c="">Todos</button>${cats.map(c => `<button class="chip ${S.cat === c ? 'on' : ''}" data-a="cat" data-c="${esc(c)}">${esc(c)}</button>`).join('')}
  ${nEsg && !S.todoCatalogo ? `<button class="chip ${S.esgotados ? 'on' : ''}" data-a="esgotados">Esgotados (${nEsg})</button>` : ''}
  <button class="chip ${S.todoCatalogo ? 'on' : ''}" data-a="todoCat">Fora da carga</button></div>
  <div class="tiles">${lista.map(m => { const saldo = m.skus.reduce((a, p) => a + (sd[p.sku]?.saldo || 0), 0) - m.skus.reduce((a, p) => a + (noCart[p.sku] || 0), 0);
    const qc = m.skus.reduce((a, p) => a + (noCart[p.sku] || 0), 0); const pr = precoShow(m.skus[0]);
    return `<button class="tile" data-a="abrirModelo" data-m="${esc(m.id)}" aria-label="${esc(m.nome)}, saldo ${saldo}">
      <div class="ph">${m.img ? `<img src="${esc(m.img)}" alt="" loading="lazy" onerror="this.remove()">` : esc(m.nome.slice(0, 2).toUpperCase())}</div>
      ${qc ? `<span class="q">${qc}</span>` : ''}<span class="s ${saldo <= 0 ? 'zero' : ''}">${saldo}</span>
      <div class="t"><div class="muted small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(curto(m.nome)[0])}</div><div class="n">${esc(curto(m.nome)[1])}</div><div class="p">${pr ? brl(pr) : '<span class="muted">sem preço</span>'}${pr && fontePreco(m.skus[0])[0] === 'erp' ? ' <span class="pill" title="Sem preço na tabela Shows e Eventos">ERP</span>' : ''}</div></div></button>`; }).join('') || '<div class="empty">Nada encontrado.</div>'}</div>`;
}
const foto = (src, cls) => `<span class="${cls}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
// avisa quando a data do show atual não bate com a noite de agora (show esquecido ou data do calendário)
function alertaData(l) {
  const sh = showAtual(l); if (!sh?.data || l.status !== 'aberto') return '';
  const dn = dataNoite(); if (sh.data === dn || (sh.dataConferida || '') === dn) return '';
  const outro = (l.shows || []).find(s => s.data === dn && s.id !== sh.id);
  const txt = sh.data > dn ? `O show atual (${esc(sh.cidade)}) está com data ${fmtD(sh.data)}, mas agora ainda é a noite de ${fmtD(dn)}. Show que começa depois da meia-noite usa a data da véspera.`
    : `O show atual (${esc(sh.cidade)}) é de ${fmtD(sh.data)}, mas agora é a noite de ${fmtD(dn)}.`;
  return `<div class="warn">⚠ ${txt}<div class="grid2" style="margin-top:8px">
    ${outro ? `<button class="btn" style="min-height:44px" data-a="usarShow" data-id="${outro.id}">Usar ${esc(outro.cidade)}/${outro.uf}</button>` : `<button class="btn" style="min-height:44px" data-a="corrigirData" data-d="${dn}">Mudar para ${fmtD(dn)}</button>`}
    <button class="btn" style="min-height:44px" data-a="dataCerta" data-d="${dn}">A data está certa</button></div></div>`;
}
function cartBar() {
  const itens = S.cart.reduce((a, c) => a + c.qtd, 0); const tot = S.cart.reduce((a, c) => a + c.qtd * c.preco, 0) - S.cartDesc;
  return `<div class="cartbar"><div class="inner">
    ${itens ? `<button class="btn" style="flex:0 0 auto;min-width:64px;min-height:64px" data-a="sheetCart" aria-label="Ver carrinho">🛒 ${itens}</button>
    <button class="btn primary" data-a="cobrar">Cobrar ${brl(tot)}</button>` : `<button class="btn" disabled>Toque num produto para vender</button>`}
  </div></div>`;
}
function tVendas(l) {
  const vs = vendasLote(l, true).sort((a, b) => b.ts.localeCompare(a.ts)); const shows = Object.fromEntries((l.shows || []).map(s => [s.id, s]));
  return `<div class="muted small" style="margin-bottom:8px">${vs.length} registros (inclui canceladas)</div>` + (vs.map(v => { const t = totalVenda(v);
    return `<div class="card" style="${v.status === 'cancelada' ? 'opacity:.55' : ''}"><div class="row"><b class="grow">#${v.num} · ${fmtDT(v.ts)}</b><b>${brl(t.liq)}</b></div>
    <div class="small muted">${esc(shows[v.showId]?.cidade || '')} · ${esc(v.vendedor)} · ${esc(v.caixa)}</div>
    <div class="small" style="margin:6px 0">${v.itens.map(i => `${i.qtd}× ${esc(S.produtos.get(i.sku)?.descricao || i.sku)} (${brl(i.preco)})`).join('<br>')}</div>
    <div class="small">${v.pagamentos.map(p => (p.nome || FORMA[p.forma]) + ' ' + brl(p.valor) + (p.parcelas > 1 ? ` ${p.parcelas}x` : '')).join(' + ')}${v.desconto ? ` · desconto ${brl(v.desconto)} (${esc(v.descMotivo || 'sem motivo')})` : ''}${v.troco ? ` · troco ${brl(v.troco)}` : ''}</div>
    ${v.status === 'cancelada' ? `<div class="small neg">Cancelada: ${esc(v.motivoCanc)}</div>` : (l.status !== 'fechado' ? `<button class="btn danger" style="margin-top:8px;min-height:44px" data-a="cancelarVenda" data-id="${v.id}">Cancelar venda</button>` : '')}</div>`; }).join('') || '<div class="empty">Nenhuma venda ainda.</div>');
}
function tMovs(l) {
  const ms = S.movs.filter(m => m.loteId === l.id).sort((a, b) => b.ts.localeCompare(a.ts));
  const tot = {}; movsLote(l).forEach(m => tot[m.tipo] = (tot[m.tipo] || 0) + m.qtd);
  return (l.status !== 'fechado' ? `<p class="muted small">Toda peça que sai sem venda precisa entrar aqui, senão aparece como falta na contagem.</p>
  <div class="pays" style="margin-top:0">${MOV_TIPOS.map(t => `<button class="pay" data-a="novoMov" data-t="${t.id}">${esc(t.nome)}<small>${esc(t.dica)}</small></button>`).join('')}</div>` : '') +
  `<div class="kpis" style="margin-bottom:12px">${MOV_TIPOS.map(t => `<div class="kpi"><b>${tot[t.id] || 0}</b><span>${esc(t.nome)}</span></div>`).join('')}</div>` +
  (ms.map(m => `<div class="card" style="${m.status === 'cancelada' ? 'opacity:.55' : ''}"><div class="row"><b class="grow">${m.qtd}× ${esc(S.produtos.get(m.sku)?.descricao || m.sku)}</b></div>
  <div class="small muted">${esc(MOV[m.tipo])} · ${fmtDT(m.ts)} · ${esc(m.quem)}${m.autorizou ? ' · autorizou ' + esc(m.autorizou) : ''}</div>${m.obs ? `<div class="small">${esc(m.obs)}</div>` : ''}
  ${m.status === 'cancelada' ? '<div class="small neg">Cancelado</div>' : (l.status !== 'fechado' ? `<button class="btn danger" style="margin-top:8px;min-height:44px" data-a="cancelarMov" data-id="${m.id}">Cancelar lançamento</button>` : '')}</div>`).join('') || '<div class="empty">Nenhuma bonificação ou retirada.</div>');
}
function tContagem(l) {
  const sd = saldos(l); const skus = Object.keys(sd).filter(s => sd[s].carga || sd[s].vendido || sd[s].mov);
  const ret = l.retorno || {}; const contados = skus.filter(s => ret[s] !== undefined).length;
  const mods = agrupar(skus.map(s => S.produtos.get(s) || { sku: s, descricao: s, var: {} }));
  if (l.status === 'fechado' || S.contagemRevelada) return divergencias(l, sd);
  return `<div class="card"><h2>Contagem de retorno (às cegas)</h2><p class="muted small">Conte o que voltou para a caixa, peça por peça. O app não mostra o esperado durante a contagem, para não influenciar. SKU sem número = não contado.</p>
  <div class="row"><span class="grow">${contados} de ${skus.length} SKUs contados</span>${l.status === 'aberto' ? `<button class="btn" style="min-height:44px" data-a="iniciarContagem">Travar vendas</button>` : '<span class="pill contagem">vendas travadas</span>'}</div>
  ${l.status === 'contagem' ? `<button class="btn block" style="margin-top:10px;min-height:48px" data-a="destravar">Destravar vendas (zera a contagem)</button>` : ''}</div>
  ${mods.map(m => `<div class="card"><div class="row" style="margin-bottom:6px">${foto(m.img, 'thumb lg')}<h2 class="grow" style="margin:0">${esc(m.nome)}</h2></div>${m.skus.sort((a, b) => (a.var?.Cor || '').localeCompare(b.var?.Cor || '') || tamIdx(a.var?.Tamanho) - tamIdx(b.var?.Tamanho)).map(p => `<div class="line">
    ${foto(fotoDe(p) || m.img, 'thumb')}<div class="grow"><div style="font-weight:700">${esc([p.var?.Cor, p.var?.Tamanho].filter(Boolean).join(' · ') || p._rot || p.sku)}</div><div class="muted small">${esc(p.sku)}</div></div>
    <div class="stepper"><button data-a="ret" data-s="${esc(p.sku)}" data-d="-1">−</button><input inputmode="numeric" data-in="ret" data-s="${esc(p.sku)}" value="${ret[p.sku] ?? ''}" placeholder="–"><button data-a="ret" data-s="${esc(p.sku)}" data-d="1">+</button></div></div>`).join('')}</div>`).join('')}
  <button class="btn primary block" data-a="revelar">Terminei: ver divergências</button>`;
}
function divergencias(l, sd) {
  const ret = l.retorno || {}; const linhas = Object.entries(sd).filter(([, x]) => x.carga || x.vendido || x.mov).map(([s, x]) => ({ s, ...x, ret: ret[s] ?? null, dif: (ret[s] ?? 0) - x.saldo }));
  const falt = linhas.filter(x => x.dif < 0), sobr = linhas.filter(x => x.dif > 0), nao = linhas.filter(x => x.ret === null && x.saldo !== 0);
  const p = s => S.produtos.get(s); const precoF = x => (p(x.s) ? precoShow(p(x.s)) : 0);
  const valFalta = falt.reduce((a, x) => a + -x.dif * precoF(x), 0);
  return `<div class="card"><h2>Resultado da contagem</h2><div class="kpis">
    <div class="kpi"><b class="${falt.length ? 'neg' : 'zerot'}">${falt.reduce((a, x) => a - x.dif, 0)}</b><span>peças faltando (${brl(valFalta)} a preço de show)</span></div>
    <div class="kpi"><b class="${sobr.length ? 'pos' : 'zerot'}">${sobr.reduce((a, x) => a + x.dif, 0)}</b><span>peças sobrando</span></div></div>
    ${nao.length ? `<div class="warn" style="margin-top:12px">${nao.length} SKUs com saldo e sem contagem contam como zero.</div>` : ''}
    <p class="muted small">Falta = venda não registrada, bonificação não lançada ou perda. Sobra = venda lançada no SKU errado ou carga a mais. Reconte antes de fechar.</p></div>
  ${linhas.filter(x => x.dif !== 0).sort((a, b) => a.dif - b.dif).map(x => `<div class="card" style="border-color:${x.dif < 0 ? 'var(--red)' : 'var(--yellow)'}">
    <div class="row"><div class="grow"><b>${esc(p(x.s)?.descricao || x.s)}</b><div class="muted small">${esc(x.s)} · esperado ${x.saldo} · contado ${x.ret ?? 0}</div></div><b class="big ${x.dif < 0 ? 'neg' : 'pos'}">${x.dif > 0 ? '+' : ''}${x.dif}</b></div>
    ${l.status !== 'fechado' ? `<input class="i" style="width:100%;margin-top:10px" data-in="obsDif" data-s="${esc(x.s)}" value="${esc((l.obsDif || {})[x.s] || '')}" placeholder="Observação (obrigatória)">
    <div class="chips">${['Bonificação não lançada', 'Venda não registrada', 'Perda / furto', 'Avaria', 'SKU trocado na venda', 'Erro na carga'].map(c => `<button class="chip" data-a="obsChip" data-s="${esc(x.s)}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>`
    : `<div class="small" style="margin-top:6px">Obs.: ${esc((l.obsDif || {})[x.s] || '—')}</div>`}</div>`).join('')}
  <div class="card tw"><table class="t"><thead><tr><th>SKU</th><th>Carga</th><th>Vend.</th><th>Bonif.</th><th>Esper.</th><th>Cont.</th><th>Dif.</th></tr></thead><tbody>
  ${linhas.sort((a, b) => a.dif - b.dif || a.s.localeCompare(b.s)).map(x => `<tr><td>${esc(x.s)}</td><td>${x.carga}</td><td>${x.vendido}</td><td>${x.mov}</td><td>${x.saldo}</td><td>${x.ret ?? '–'}</td><td class="${x.dif < 0 ? 'neg' : x.dif > 0 ? 'pos' : 'zerot'}">${x.dif > 0 ? '+' : ''}${x.dif}</td></tr>`).join('')}
  </tbody></table></div>
  ${l.status === 'contagem' ? `<button class="btn block" style="margin-bottom:10px;min-height:48px" data-a="destravar">Destravar vendas (zera a contagem)</button>` : ''}
  ${l.status !== 'fechado' ? `<div class="grid2"><button class="btn" data-a="recontar">Voltar e recontar</button><button class="btn ok" data-a="fecharLote">Fechar lote</button></div>` : `<div class="muted small">Lote fechado em ${fmtDT(l.fechadoEm)} por ${esc(l.fechadoPor)}.</div>`}`;
}
const pctTaxa = x => (x.valor ? x.taxa / x.valor * 100 : 0).toFixed(2).replace('.', ',') + '%';
function tabelaGrupo(o, titulo, comTaxa = true, total = false) {
  const ks = Object.entries(o).sort((a, b) => b[1].valor - a[1].valor); if (!ks.length) return '';
  const t = ks.reduce((s, [, x]) => ({ n: s.n + x.n, valor: s.valor + x.valor, taxa: s.taxa + x.taxa, liq: s.liq + x.liq }), { n: 0, valor: 0, taxa: 0, liq: 0 });
  const linha = (k, x, tag = 'td') => `<tr><${tag}>${esc(k)}</${tag}><${tag}>${x.n}</${tag}><${tag}>${brl(x.valor)}</${tag}>${comTaxa ? `<${tag}>${brl(x.taxa)}</${tag}><${tag}>${pctTaxa(x)}</${tag}><${tag}>${brl(x.liq)}</${tag}>` : ''}</tr>`;
  return `<div class="tw"><table class="t" style="margin:8px 0"><thead><tr><th>${titulo}</th><th>Qtd</th><th>Bruto</th>${comTaxa ? '<th>Taxa</th><th>Taxa efetiva</th><th>Líquido</th>' : ''}</tr></thead><tbody>
  ${ks.map(([k, x]) => linha(k, x)).join('')}${total ? linha('Total', t, 'th') : ''}</tbody></table></div>`;
}
function cardInfinite(l) {
  const a = analiseInfinite(l); if (!a) return '';
  return `<div class="card"><h2>Conferência InfinitePay</h2>
  <div class="kpis"><div class="kpi"><b>${brl(a.bruto)}</b><span>bruto aprovado</span></div><div class="kpi"><b>${brl(a.taxa)}</b><span>taxas (${a.brutoCartao ? (a.taxa / a.brutoCartao * 100).toFixed(2).replace('.', ',') : 0}% dos cartões)</span></div>
  <div class="kpi"><b>${brl(a.liq)}</b><span>líquido a receber</span></div><div class="kpi"><b class="${a.semPdv.length || a.semTx.length ? 'neg' : 'zerot'}">${a.conciliadas}/${a.pags}</b><span>pagamentos do PDV conciliados</span></div></div>
  ${a.semPdv.length ? `<div class="warn" style="margin-top:12px"><b>${a.semPdv.length} transações sem venda no PDV</b> (${brl(a.semPdv.reduce((x, t) => x + t.valor, 0))}): venda não registrada ou valor diferente.<br>${a.semPdv.slice(0, 8).map(t => `${fmtDT(t.t)} · ${FORMA[t.forma]} ${brl(t.valor)} · ${esc(t.term)}`).join('<br>')}${a.semPdv.length > 8 ? '<br>…' : ''}</div>` : ''}
  ${a.semTx.length ? `<div class="warn"><b>${a.semTx.length} pagamentos do PDV sem transação</b>: confira valor e forma.<br>${a.semTx.slice(0, 8).map(p => `Venda #${p.num} · ${FORMA[p.forma]} ${brl(p.valor)}`).join('<br>')}</div>` : ''}
  ${a.negadas.length ? `<p class="small muted">${a.negadas.length} negadas/canceladas na maquininha (não entram nos totais).</p>` : ''}
  <h2 style="margin-top:12px">Por forma e bandeira (baixa do contas a receber)</h2>
  <p class="muted small">Baixe cada linha no contas a receber do Tiny pelo bruto, com a taxa como despesa: o líquido é o que cai na conta.</p>
  ${tabelaGrupo(a.porFormaBand, 'Forma · bandeira', true, true)}
  <h2>Por origem</h2>${tabelaGrupo(a.porTerm, 'Origem')}
  ${Object.keys(a.porParc).length ? `<h2>Crédito por parcelas</h2>${tabelaGrupo(a.porParc, 'Parcelas')}` : ''}
  <h2>Por show (pela data da transação)</h2>${tabelaGrupo(a.porShow, 'Show')}</div>`;
}
// ---------- conferência financeira: recebido de verdade x PDV, com diferença justificada ----------
const CATS_AJ = [
  { id: 'desconto', nome: 'Desconto não lançado', dir: 'menos', venda: true },
  { id: 'venda_nr', nome: 'Venda não registrada no app', dir: 'mais', venda: true, sku: true },
  { id: 'preco', nome: 'Preço lançado errado', dir: '', venda: true },
  { id: 'estorno', nome: 'Estorno / cancelamento na maquininha', dir: 'menos', venda: true },
  { id: 'troco', nome: 'Quebra de caixa / troco errado', dir: 'menos', venda: false },
  { id: 'forma', nome: 'Forma de pagamento trocada', dir: '', venda: false, neutro: true },
  { id: 'outro', nome: 'Outro', dir: '', venda: false }];
const CAT_AJ = Object.fromEntries(CATS_AJ.map(c => [c.id, c]));
function fin(l) {
  const f = l.fin ||= { real: {}, outros: [], ajustes: [], concluido: false };
  const r = resumo(l); const inf = l.conferenciaInfinite;
  const real = {}; ['pix', 'credito', 'debito'].forEach(k => real[k] = f.real[k] ?? (inf ? (inf.formas[k] || 0) : null)); real.dinheiro = f.real.dinheiro ?? null;
  const outros = f.outros.reduce((a, o) => a + (o.valor || 0), 0);
  const faltaInformar = Object.entries(real).filter(([, v]) => v === null).map(([k]) => FORMA[k]);
  const realTotal = Object.values(real).reduce((a, v) => a + (v || 0), 0) + outros;
  const sinal = a => (a.dir === 'menos' ? -1 : 1) * (a.valor || 0);
  const justificado = f.ajustes.filter(a => !CAT_AJ[a.cat]?.neutro).reduce((s, a) => s + sinal(a), 0);
  const ajVenda = f.ajustes.filter(a => CAT_AJ[a.cat]?.venda).reduce((s, a) => s + sinal(a), 0);
  const dif = +(realTotal - r.liq).toFixed(2); const pendente = +(dif - justificado).toFixed(2);
  return { f, r, real, outros, realTotal, dif, justificado, pendente, ajVenda, vendaAjustada: r.liq + ajVenda, sinal, faltaInformar, pronto: !faltaInformar.length && Math.abs(pendente) < 0.01 };
}
// itens do pedido de venda e da perda depois da conferência: venda não registrada com SKU passa da perda para a venda;
// o restante do ajuste que mexe na venda é rateado pelos itens vendidos, proporcional ao valor
function baixasAjustadas(l) {
  const sd = saldos(l); const ret = l.retorno || {}; const F = fin(l);
  const itens = {}; Object.entries(sd).forEach(([s, x]) => { const dif = ret[s] === undefined ? 0 : ret[s] - x.saldo; itens[s] = { q: x.vendido, valor: x.valor, perda: dif < 0 ? -dif : 0, bonif: x.mov }; });
  let resto = F.ajVenda;
  F.f.ajustes.filter(a => a.cat === 'venda_nr' && a.sku && a.qtd && !l.perdaExportada).forEach(a => { const it = itens[a.sku] ||= { q: 0, valor: 0, perda: 0, bonif: 0 };
    const v = F.sinal(a); it.q += a.qtd; it.valor += v; it.perda = Math.max(0, it.perda - a.qtd); resto -= v; });
  const base = Object.values(itens).reduce((s, it) => s + (it.q ? it.valor : 0), 0);
  if (base && Math.abs(resto) > 0.001) Object.values(itens).forEach(it => { if (it.q) it.valor += resto * it.valor / base; });
  return itens;
}
function tFinanceiro(l) {
  const F = fin(l); const inf = l.conferenciaInfinite; const fe = F.f.concluido; const dis = fe ? 'disabled' : '';
  const linhaReal = (k, nome, dica) => `<div class="line"><div class="grow"><b>${nome}</b><div class="muted small">PDV ${brl(F.r.formas[k] || 0)} · ${dica}</div></div>
    <input class="i" style="width:130px;text-align:right" inputmode="decimal" data-in="finReal" data-f="${k}" ${dis} value="${F.real[k] === null ? '' : String(+F.real[k].toFixed(2)).replace('.', ',')}" placeholder="R$"></div>`;
  return `<div class="card"><h2>1. Quanto entrou de verdade</h2>
    <p class="muted small">O valor do pedido de venda no Tiny sai desta conferência, não do que foi lançado no show.</p>
    ${linhaReal('pix', 'Pix (InfinitePay)', inf ? 'do extrato' : 'importe o extrato no Relatório')}
    ${linhaReal('credito', 'Crédito', inf ? 'do extrato' : 'importe o extrato no Relatório')}
    ${linhaReal('debito', 'Débito', inf ? 'do extrato' : 'importe o extrato no Relatório')}
    ${linhaReal('dinheiro', 'Dinheiro', 'contado no caixa')}
    ${F.f.outros.map((o, i) => `<div class="line"><input class="i grow" style="min-width:0" data-in="outroNome" data-i="${i}" ${dis} value="${esc(o.nome)}" placeholder="Meio (ex.: Pix Sicoob)"><input class="i" style="width:110px;text-align:right" inputmode="decimal" data-in="outroValor" data-i="${i}" ${dis} value="${o.valor ? String(o.valor).replace('.', ',') : ''}" placeholder="R$">${fe ? '' : `<button class="iconbtn" data-a="rmOutro" data-i="${i}">✕</button>`}</div>`).join('')}
    ${fe ? '' : `<button class="btn block" style="min-height:48px;margin-top:8px" data-a="addOutro">+ Outro meio (Pix Sicoob, Mercado Pago…)</button>`}
    ${F.r.formas.outro ? `<p class="small muted">No PDV: ${brl(F.r.formas.outro)} lançados como "outro meio".</p>` : ''}</div>
  <div class="card"><h2>2. Diferença</h2><div class="kpis">
    <div class="kpi"><b>${brl(F.r.liq)}</b><span>lançado no PDV</span></div><div class="kpi"><b>${brl(F.realTotal)}</b><span>recebido de verdade</span></div>
    <div class="kpi"><b class="${Math.abs(F.dif) < .01 ? 'zerot' : 'neg'}">${brl(F.dif)}</b><span>diferença</span></div><div class="kpi"><b class="${Math.abs(F.pendente) < .01 ? 'zerot' : 'neg'}">${brl(F.pendente)}</b><span>sem justificativa</span></div></div>
    ${F.faltaInformar.length ? `<div class="warn" style="margin-top:12px">Falta informar: ${F.faltaInformar.join(', ')}.</div>` : ''}</div>
  ${(() => { const a = analiseInfinite(l); if (!a || fe) return ''; const usados = new Set(F.f.ajustes.map(x => x.txId).filter(Boolean));
    const lst = a.semPdv.filter(t => !usados.has(t.id + t.t)); if (!lst.length) return '';
    return `<div class="card"><h2>Do extrato: pagamentos sem venda no app</h2>
    <p class="muted small">Entraram na InfinitePay e não têm venda lançada. Se foram vendas, lance como "venda não registrada" e escolha a peça que faltou na contagem: ela sai da perda e entra no pedido de venda.</p>
    ${lst.map(t => `<div class="line"><div class="grow"><b>${brl(t.valor)}</b> · ${FORMA[t.forma]}${t.parc > 1 ? ' ' + t.parc + 'x' : ''}<div class="muted small">${fmtDT(t.t)} · ${esc(t.term)}</div></div><button class="btn" style="min-height:44px" data-a="ajusteDeTx" data-tx="${esc(t.id + t.t)}">Justificar</button></div>`).join('')}</div>`; })()}
  <div class="card"><h2>3. Justificativas</h2>
    <p class="muted small">Toda diferença precisa de explicação. Desconto não lançado, venda não registrada, preço errado e estorno mudam o valor da venda. Quebra de caixa e "outro" não mudam a venda nem o DAS, mas saem da margem do show. Forma trocada só explica diferença entre formas.</p>
    ${F.f.ajustes.map((a, i) => `<div class="line"><div class="grow"><b>${esc(CAT_AJ[a.cat]?.nome || a.cat)}</b><div class="muted small">${a.sku ? esc(a.sku) + ' · ' + a.qtd + ' pç · ' : ''}${esc(a.obs || '')}${CAT_AJ[a.cat]?.venda ? ' · muda a venda' : ''}</div></div><b class="${a.dir === 'menos' ? 'neg' : 'pos'}">${CAT_AJ[a.cat]?.neutro ? '' : a.dir === 'menos' ? '−' : '+'}${brl(a.valor)}</b>${fe ? '' : `<button class="iconbtn" data-a="rmAjuste" data-i="${i}">✕</button>`}</div>`).join('') || '<div class="muted small">Nenhuma ainda.</div>'}
    ${fe ? '' : `<button class="btn block" style="min-height:48px;margin-top:8px" data-a="novoAjuste">+ Justificar diferença</button>`}</div>
  <div class="card"><h2>4. Resultado</h2>
    <div class="line"><span class="grow">Venda no pedido do Tiny</span><b>${brl(F.vendaAjustada)}</b></div>
    <div class="line"><span class="grow">Ajustes fora da venda (quebra de caixa, outros)</span><b>${brl(F.justificado - F.ajVenda)}</b></div>
    ${fe ? `<p class="small">Conferência concluída em ${fmtDT(F.f.concluidoEm)} por ${esc(F.f.concluidoPor)}.</p><button class="btn block" data-a="reabrirFin">Reabrir conferência</button>`
      : `<button class="btn ok block" ${F.pronto ? '' : 'disabled'} data-a="concluirFin">Concluir conferência financeira</button>${F.pronto ? '' : '<p class="muted small">Libera quando todas as formas estiverem informadas e a diferença sem justificativa for zero.</p>'}`}</div>`;
}
// ---------- margem de contribuição por show ----------
const CATS_DESP = ['Comissão sobre vendas', 'Diárias de alimentação', 'Fotos', 'Transporte / combustível', 'Hospedagem', 'Material de venda', 'Outros'];
// Receita (conferida ou PDV) − DAS − taxas de cartão − CMV − bonificações − perdas − despesas − quebra de caixa, por show e no lote
function margem(l) {
  const F = fin(l); const conf = F.f.concluido; const shows = l.shows || [];
  const cols = shows.map(s => ({ id: s.id, nome: `${s.cidade}/${s.uf}`, data: s.data, rec: 0, das: 0, taxa: 0, cmv: 0, bonif: 0, perda: 0, desp: 0, quebra: 0, despItens: [] }));
  const col = id => cols.find(c => c.id === id) || cols[0];
  const custo = sku => custoDe(sku); const semCusto = new Set();
  const cmvDe = (sku, q) => { const c = custo(sku); if (!c && q) semCusto.add(sku); return c * q; };
  // receita e CMV das vendas registradas, no show em que aconteceram
  vendasLote(l).forEach(v => { const c = col(v.showId); if (!c) return; c.rec += totalVenda(v).liq; v.itens.forEach(i => c.cmv += cmvDe(i.sku, i.qtd)); });
  // taxas de cartão: reais do extrato (pela data da transação) ou estimadas pelo PDV
  const an = analiseInfinite(l); let taxaReal = false;
  if (an) { taxaReal = true; Object.entries(an.porShow).forEach(([nome, x]) => { const c = cols.find(c => c.nome === nome); if (c) c.taxa += x.taxa; else if (cols[0]) cols[0].taxa += x.taxa; }); }
  else vendasLote(l).forEach(v => { const c = col(v.showId); if (c) v.pagamentos.forEach(p => c.taxa += p.valor * taxaEst(p) / 100); });
  // ajustes da conferência financeira que mudam a venda: venda achada no extrato vai para o show da transação; o resto é rateado
  const recPDV = cols.reduce((a, c) => a + c.rec, 0); const peso = c => recPDV ? c.rec / recPDV : 1 / (cols.length || 1);
  const showDoAjuste = a => { if (!a.txId || !an) return null; const t = an.ap.find(t => t.id + t.t === a.txId); if (!t) return null;
    const d = new Date(+new Date(t.t) - CORTE_H * 3600e3); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); const dia = d.toISOString().slice(0, 10);
    return cols.filter(c => c.data <= dia && (+new Date(dia) - +new Date(c.data)) <= 864e5).sort((x, y) => y.data.localeCompare(x.data))[0] || null; };
  if (conf) F.f.ajustes.filter(a => CAT_AJ[a.cat]?.venda).forEach(a => {
    const v = F.sinal(a); const alvo = showDoAjuste(a);
    if (alvo) alvo.rec += v; else cols.forEach(c => c.rec += v * peso(c));
    if (a.cat === 'venda_nr' && a.sku && a.qtd && !l.perdaExportada) { const k = cmvDe(a.sku, a.qtd); if (alvo) alvo.cmv += k; else cols.forEach(c => c.cmv += k * peso(c)); }
  });
  // bonificações a custo no show em que saíram; perdas da contagem (já descontadas as vendas achadas) rateadas pela receita
  movsLote(l).forEach(m => { const c = col(m.showId); if (c) c.bonif += cmvDe(m.sku, m.qtd); });
  const perdaTot = Object.entries(baixasAjustadas(l)).reduce((a, [s, it]) => a + cmvDe(s, it.perda), 0);
  const recTot = cols.reduce((a, c) => a + c.rec, 0); const pesoF = c => recTot ? c.rec / recTot : 1 / (cols.length || 1);
  cols.forEach(c => { c.perda = perdaTot * pesoF(c); c.das = c.rec * (S.cfg.das || 0) / 100; });
  // despesas: do show ou do lote (rateadas pela receita); comissão em % incide sobre a receita
  (l.despesas || []).forEach(d => {
    const alvo = d.showId ? cols.filter(c => c.id === d.showId) : cols;
    alvo.forEach(c => { const base = d.showId ? 1 : pesoF(c); const v = d.tipo === 'pct' ? c.rec * d.valor / 100 : d.valor * base; c.desp += v; c.despItens.push({ ...d, efetivo: v }); });
  });
  // quebra de caixa e "outro": não mudam a venda (nem o pedido do Tiny, nem o DAS), mas tiram dinheiro do resultado.
  // Positivo = faltou dinheiro. Vai para o show da transação, se houver; senão é rateado pela receita.
  if (conf) F.f.ajustes.filter(a => !CAT_AJ[a.cat]?.venda && !CAT_AJ[a.cat]?.neutro).forEach(a => {
    const v = -F.sinal(a); const alvo = showDoAjuste(a);
    if (alvo) alvo.quebra += v; else cols.forEach(c => c.quebra += v * pesoF(c));
  });
  cols.forEach(c => { c.mc = c.rec - c.das - c.taxa - c.cmv - c.bonif - c.perda - c.desp - c.quebra; c.pct = c.rec ? c.mc / c.rec * 100 : 0; });
  const tot = { nome: 'Total do lote', rec: 0, das: 0, taxa: 0, cmv: 0, bonif: 0, perda: 0, desp: 0, quebra: 0, mc: 0 };
  cols.forEach(c => ['rec', 'das', 'taxa', 'cmv', 'bonif', 'perda', 'desp', 'quebra', 'mc'].forEach(k => tot[k] += c[k])); tot.pct = tot.rec ? tot.mc / tot.rec * 100 : 0;
  return { cols, tot, conf, taxaReal, semCusto: [...semCusto] };
}
const LINHAS_MG = [['rec', 'Receita'], ['das', '(−) DAS'], ['taxa', '(−) Taxas de cartão'], ['cmv', '(−) CMV (custo das peças)'], ['bonif', '(−) Bonificações a custo'], ['perda', '(−) Perdas da contagem'], ['desp', '(−) Despesas do show'], ['quebra', '(−) Quebra de caixa e outros ajustes'], ['mc', '= Margem de contribuição']];
function tabelaMargem(M, cls = 't') {
  const cs = M.cols.length > 1 ? [...M.cols, M.tot] : [M.tot];
  return `<table class="${cls}"><thead><tr><th class="l"></th>${cs.map(c => `<th>${esc(c.nome)}</th>`).join('')}</tr></thead><tbody>
  ${LINHAS_MG.map(([k, n]) => `<tr${k === 'mc' ? ' style="font-weight:800"' : ''}><td class="l">${n}</td>${cs.map(c => `<td class="${k === 'mc' && c.mc < 0 ? 'neg' : ''}">${brl(c[k])}</td>`).join('')}</tr>`).join('')}
  <tr><td class="l">Margem %</td>${cs.map(c => `<td class="${c.pct < 0 ? 'neg' : ''}">${c.pct.toFixed(1).replace('.', ',')}%</td>`).join('')}</tr></tbody></table>`;
}
function tMargem(l) {
  const M = margem(l);
  const avisos = [];
  if (!M.conf) avisos.push('Prévia: a receita é a lançada no PDV. Conclua a conferência financeira para usar a venda conferida.');
  if (!S.cfg.das) avisos.push('DAS em 0%: informe a alíquota efetiva em ⚙ › Margem por show.');
  if (!Object.keys(S.custos).length) avisos.push('Custos oficiais não importados: a margem usa o custo do Tiny, que está zerado em parte dos SKUs. Catálogo › Custos oficiais.');
  if (M.semCusto.length) avisos.push(`${M.semCusto.length} SKUs vendidos ou bonificados sem custo no cadastro (CMV subestimado): ${M.semCusto.slice(0, 6).map(esc).join(', ')}${M.semCusto.length > 6 ? '…' : ''}.`);
  if (!M.taxaReal) avisos.push('Taxas de cartão estimadas pela tabela em ⚙. Importe o extrato da InfinitePay no Relatório para usar as reais.');
  const shows = Object.fromEntries((l.shows || []).map(s => [s.id, s]));
  return `${avisos.map(a => `<div class="warn">${a}</div>`).join('')}
  <div class="card"><h2>Margem por show</h2><div class="kpis" style="margin-bottom:10px"><div class="kpi"><b>${brl(M.tot.mc)}</b><span>margem de contribuição do lote</span></div><div class="kpi"><b class="${M.tot.pct < 0 ? 'neg' : ''}">${M.tot.pct.toFixed(1).replace('.', ',')}%</b><span>sobre a receita</span></div></div>
  <div class="tw">${tabelaMargem(M)}</div></div>
  <div class="card"><h2>Despesas do show</h2>
  <p class="muted small">Comissão, diárias de alimentação, fotos e o que mais sair do caixa do show. Ônibus e hotel são da turnê. Despesa do lote inteiro é rateada pela receita de cada show.</p>
  ${(l.despesas || []).map((d, i) => `<div class="line"><div class="grow"><b>${esc(d.cat)}</b><div class="muted small">${d.showId ? esc(shows[d.showId]?.cidade || '') : 'Todo o lote'}${d.obs ? ' · ' + esc(d.obs) : ''} · ${esc(d.quem || '')}</div></div><b>${d.tipo === 'pct' ? String(d.valor).replace('.', ',') + '% da venda' : brl(d.valor)}</b><button class="iconbtn" data-a="rmDesp" data-i="${i}">✕</button></div>`).join('') || '<div class="muted small">Nenhuma despesa lançada.</div>'}
  <button class="btn primary block" style="margin-top:10px" data-a="novaDesp">+ Lançar despesa</button></div>`;
}
function tRelatorio(l) {
  const r = resumo(l); const sh = l.shows || [];
  const inf = S.infinite && S.infinite.loteId === l.id ? S.infinite : null;
  return `<div class="card"><h2>Resumo do lote</h2><div class="kpis">
    <div class="kpi"><b>${brl(r.liq)}</b><span>vendas líquidas</span></div><div class="kpi"><b>${r.n}</b><span>vendas (${r.canc} canceladas)</span></div>
    <div class="kpi"><b>${r.pecas}</b><span>peças vendidas</span></div><div class="kpi"><b>${brl(r.ticket)}</b><span>ticket médio</span></div></div>
    ${r.desc ? `<p class="small muted">Descontos: ${brl(r.desc)} sobre ${brl(r.bruto)} brutos.</p>` : ''}</div>
  <div class="card"><h2>Por forma de pagamento</h2>${FORMAS.map(f => `<div class="line"><span class="grow">${f.nome}</span><b>${brl(r.formas[f.id] || 0)}</b>${inf && !FORA_INFINITE.includes(f.id) ? `<span class="small ${Math.abs((inf.formas[f.id] || 0) - (r.formas[f.id] || 0)) > 0.5 ? 'neg' : 'zerot'}" style="min-width:110px;text-align:right">InfinitePay ${brl(inf.formas[f.id] || 0)}</span>` : ''}</div>`).join('')}
    <label class="btn block" style="margin-top:10px">${inf ? 'Trocar' : 'Conferir com'} extrato da InfinitePay<input type="file" accept=".xls,.xlsx,.csv" class="hide" data-in="infinite"></label>
    ${inf ? `<p class="small muted">${inf.n} transações aprovadas entre ${fmtDT(inf.de)} e ${fmtDT(inf.ate)}.</p>` : `<p class="small muted">Exporte as transações do período no app da InfinitePay e importe aqui. Taxas estimadas pelo PDV: <b>${brl(taxasPdv(l))}</b> (líquido estimado ${brl(r.liq - taxasPdv(l))}).</p>`}</div>
  ${cardInfinite(l)}
  <div class="card"><h2>Por show</h2>${sh.map(s => { const x = resumo(l, s.id); return `<div class="line"><div class="grow"><b>${esc(s.cidade)}/${s.uf}</b><div class="muted small">${fmtD(s.data)}${s.evento ? ' · ' + esc(s.evento) : ''}</div></div><div style="text-align:right"><b>${brl(x.liq)}</b><div class="muted small">${x.n} vendas · ${x.pecas} pç</div></div></div>`; }).join('')}</div>
  ${l.status !== 'fechado' ? '<div class="warn">O relatório final sai depois da contagem e do fechamento. Antes disso, é parcial.</div>' : ''}
  <button class="btn primary block" data-a="pdf">Gerar PDF ${l.status === 'fechado' ? 'final' : 'parcial'}</button>
  <div class="card" style="margin-top:12px"><h2>Arquivos para importar no Tiny</h2>
  <p class="muted small">No layout de importação de pedidos. Bonificação e perda vão em pedidos separados, valorizados a custo, para não mexer no preço médio da venda. Ordem: contagem física (fechar lote) › conferência financeira › venda e perda.</p>
  <button class="btn block" data-a="tinyCsv" data-t="venda">Pedido de venda (só o vendido)</button>
  <div class="grid2" style="margin-top:10px"><button class="btn" data-a="tinyCsv" data-t="bonif">Bonificação<br><small>CFOP ${esc(S.cfg.cfopBonif)}</small></button><button class="btn" data-a="tinyCsv" data-t="perda" ${l.status !== 'fechado' || !fin(l).f.concluido ? 'style="opacity:.5"' : ''}>Perda<br><small>CFOP ${esc(S.cfg.cfopPerda)}</small></button></div></div>
  <div class="grid2" style="margin-top:10px"><button class="btn" data-a="csvTiny">Planilha de conferência</button><button class="btn" data-a="exportarCaixa">Enviar caixa</button></div>
  <p class="muted small">"Enviar caixa" gera um arquivo com as vendas deste aparelho. No caixa principal, use "Receber caixa" na tela inicial para juntar.</p>`;
}

// ---------- bottom sheets ----------
function renderSheet() {
  let el = $('#sheet'); if (!S.sheet) { el && el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'sheet'; el.className = 'scrim'; document.body.appendChild(el); }
  const k = S.sheet.k; let h = '';
  if (k === 'modelo') h = shModelo(); if (k === 'cart') h = shCart(); if (k === 'pagar') h = shPagar(); if (k === 'show') h = shShow();
  if (k === 'mov') h = shMov(); if (k === 'texto') h = shTexto(); if (k === 'cargaPrev') h = shCargaPrev(); if (k === 'ajuste') h = shAjuste(); if (k === 'despesa') h = shDespesa();
  el.innerHTML = `<div class="sheet" role="dialog"><div class="grab"></div>${h}</div>`;
}
function shModelo() {
  const l = lote(); const sd = saldos(l); const m = agrupar([...S.produtos.values()].filter(p => modeloDe(p) === S.sheet.m))[0]; if (!m) return '';
  const noCart = {}; S.cart.forEach(c => noCart[c.sku] = (noCart[c.sku] || 0) + c.qtd);
  const modo = S.sheet.modo || 'venda'; let skus = m.skus; if (!S.todoCatalogo && modo === 'venda') skus = skus.filter(p => sd[p.sku]?.carga);
  const temTam = skus.some(p => p.var?.Tamanho); const cores = {};
  skus.forEach(p => { const c = temTam ? (p.var?.Cor || '—') : 'Escolha a variação'; (cores[c] ||= []).push(p); });
  return `<div class="row"><div class="grow"><h3>${esc(m.nome)}</h3><div class="muted">${modo === 'venda' ? brl(precoShow(m.skus[0])) + ' · toque no tamanho para adicionar' : 'Escolha a peça'}</div></div><button class="iconbtn" data-a="fechar">✕</button></div>
  ${Object.entries(cores).sort().map(([c, ps]) => `<div class="vargroup"><div class="lbl">${esc(c)}</div><div class="sizes">${ps.sort((a, b) => tamIdx(a.var?.Tamanho) - tamIdx(b.var?.Tamanho)).map(p => { const s = (sd[p.sku]?.saldo || 0) - (noCart[p.sku] || 0);
    return `<button class="size ${s <= 0 ? 'zero' : ''}" ${temTam ? '' : 'style="grid-column:span 2;font-size:15px;padding:6px"'} data-a="${modo === 'venda' ? 'add' : 'pickMov'}" data-s="${esc(p.sku)}">${esc(temTam ? p.var.Tamanho || 'UN' : p._rot || 'UN')}<small>${s} disp.</small>${noCart[p.sku] && modo === 'venda' ? `<span class="badge">${noCart[p.sku]}</span>` : ''}</button>`; }).join('')}</div></div>`).join('')}
  ${modo === 'venda' ? `<button class="btn primary block" data-a="fechar">Pronto</button>` : ''}`;
}
function shCart() {
  const sub = S.cart.reduce((a, c) => a + c.qtd * c.preco, 0);
  return `<div class="row"><h3 class="grow">Carrinho</h3><button class="iconbtn" data-a="fechar">✕</button></div>
  ${S.cart.map((c, i) => { const p = S.produtos.get(c.sku); return `<div class="line"><div class="grow"><div style="font-weight:600">${esc(p ? nomeModelo(p) : c.sku)}</div><div class="muted small">${esc([p?.var?.Cor, p?.var?.Tamanho].filter(Boolean).join(' · '))} · <button class="small" style="text-decoration:underline;min-height:32px" data-a="precoItem" data-i="${i}">${brl(c.preco)}</button></div></div>
    <div class="stepper"><button data-a="qtd" data-i="${i}" data-d="-1">−</button><input readonly value="${c.qtd}"><button data-a="qtd" data-i="${i}" data-d="1">+</button></div></div>`; }).join('') || '<div class="empty">Vazio</div>'}
  <div class="total"><span class="muted">Subtotal</span><b>${brl(sub)}</b></div>
  <div class="total"><button class="btn" style="min-height:44px" data-a="desconto">${S.cartDesc ? 'Desconto ' + brl(S.cartDesc) : '+ Desconto'}</button><b>${brl(sub - S.cartDesc)}</b></div>
  <div class="grid2"><button class="btn danger" data-a="limparCart">Esvaziar</button><button class="btn primary" data-a="cobrar">Cobrar</button></div>`;
}
function shPagar() {
  const tot = +(S.cart.reduce((a, c) => a + c.qtd * c.preco, 0) - S.cartDesc).toFixed(2); const pago = +S.pagamentos.reduce((a, p) => a + p.valor, 0).toFixed(2); const falta = +(tot - pago).toFixed(2);
  const troco = S.pagamentos.reduce((a, p) => a + (p.troco || 0), 0); const st = S.sheet;
  if (st.forma === 'dinheiro') return `<div class="row"><h3 class="grow">Dinheiro</h3><button class="iconbtn" data-a="volPag">‹</button></div>
    <div class="total"><span class="muted">A receber</span><b class="big">${brl(falta)}</b></div>
    <label class="f">Valor recebido do cliente<input class="i" id="recebido" inputmode="decimal" placeholder="${falta.toFixed(2).replace('.', ',')}" style="font-size:24px"></label>
    <div class="chips">${[falta, 50, 100, 150, 200, 250, 300].filter((v, i, a) => v >= falta && a.indexOf(v) === i).slice(0, 5).map(v => `<button class="chip" data-a="recebido" data-v="${v}">${brl(v)}</button>`).join('')}</div>
    <div id="trocoBox" class="total"><span class="muted">Troco</span><b class="big">${brl(0)}</b></div>
    <button class="btn ok block" data-a="confDinheiro">Confirmar dinheiro</button>`;
  if (st.forma === 'credito') return `<div class="row"><h3 class="grow">Crédito · ${brl(st.valor ?? falta)}</h3><button class="iconbtn" data-a="volPag">‹</button></div>
    <p class="muted">Parcelas (até 6x sem juros)</p><div class="sizes">${[1, 2, 3, 4, 5, 6].map(n => `<button class="size" data-a="parcelas" data-n="${n}">${n}x<small>${brl((st.valor ?? falta) / n)}</small></button>`).join('')}</div>`;
  return `<div class="row"><h3 class="grow">Pagamento</h3><button class="iconbtn" data-a="fechar">✕</button></div>
  <div class="total"><span class="muted">${pago ? 'Falta' : 'Total'}</span><b class="big">${brl(falta)}</b></div>
  ${S.pagamentos.length ? `<div class="card">${S.pagamentos.map((p, i) => `<div class="line"><span class="grow">${p.nome ? esc(p.nome) : FORMA[p.forma]}${p.parcelas > 1 ? ' ' + p.parcelas + 'x' : ''}${p.troco ? ` <span class="muted small">(recebeu ${brl(p.valor + p.troco)}, troco ${brl(p.troco)})</span>` : ''}</span><b>${brl(p.valor)}</b><button class="iconbtn" data-a="rmPag" data-i="${i}">✕</button></div>`).join('')}</div>` : ''}
  ${falta > 0 ? `<div class="pays">${FORMAS.map(f => `<button class="pay ${f.cls}" data-a="forma" data-f="${f.id}">${f.nome}<small>${brl(st.parcial ?? falta)}</small></button>`).join('')}</div>
    <button class="btn block" style="min-height:48px" data-a="dividir">${st.parcial != null ? 'Valor parcial: ' + brl(st.parcial) + ' (trocar)' : 'Dividir em duas formas'}</button>`
    : `<button class="btn ok block" style="min-height:72px;font-size:21px" data-a="finalizar">Confirmar venda${troco ? ' · troco ' + brl(troco) : ''}</button>`}
  <p class="muted small">Confirme só depois que a maquininha aprovar.</p>`;
}
function shShow() {
  const l = lote(); const at = showAtual(l);
  return `<div class="row"><h3 class="grow">Show atual</h3><button class="iconbtn" data-a="fechar">✕</button></div>
  <p class="muted small">As vendas entram no show marcado. Troque ao chegar na próxima cidade; a carga continua a mesma do lote.</p>
  ${(l.shows || []).map(s => `<button class="card" style="width:100%;text-align:left;${at && at.id === s.id ? 'border:2px solid var(--orange)' : ''}" data-a="usarShow" data-id="${s.id}"><div class="row"><b class="grow">${at && at.id === s.id ? '📍 ' : ''}${esc(s.cidade)}/${s.uf} · ${fmtD(s.data)}</b>${at && at.id === s.id ? '<span class="pill aberto">ATUAL</span>' : ''}</div><div class="muted small">${esc(s.evento || '')}</div></button>`).join('')}
  <button class="btn block" style="margin-bottom:12px" data-a="exportarCaixa">Enviar minhas vendas (caixa) para o principal</button>
  ${l.status === 'aberto' ? `<form data-f="novoShow" class="card"><h2>Adicionar show</h2>
    <label class="f">Cidade<input class="i" name="cidade" required></label>
    <div class="grid2"><label class="f">UF<select class="i" name="uf" required><option value="">--</option>${UFS.map(u => `<option ${at && at.uf === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label><label class="f">Data<input class="i" type="date" name="data" value="${dataNoite()}" required></label></div>
    <label class="f">Evento / local<input class="i" name="evento"></label><button class="btn primary block">Adicionar e usar</button></form>` : ''}`;
}
function shMov() {
  const st = S.sheet;
  if (!st.sku) { const l = lote(); const sd = saldos(l); const mods = agrupar([...S.produtos.values()].filter(p => st.tipo === '__carga' || sd[p.sku]?.carga));
    return `<div class="row"><h3 class="grow">${esc(MOV[st.tipo])}: qual peça?</h3><button class="iconbtn" data-a="fechar">✕</button></div>
    <div class="tiles">${mods.map(m => `<button class="tile" data-a="movModelo" data-m="${esc(m.id)}"><div class="ph">${m.img ? `<img src="${esc(m.img)}" alt="" loading="lazy" onerror="this.remove()">` : esc(m.nome.slice(0, 2).toUpperCase())}</div><div class="t"><div class="n">${esc(m.nome)}</div></div></button>`).join('')}</div>`; }
  const p = S.produtos.get(st.sku);
  return `<div class="row"><h3 class="grow">${esc(MOV[st.tipo])}</h3><button class="iconbtn" data-a="fechar">✕</button></div>
  <p><b>${esc(p?.descricao || st.sku)}</b><br><span class="muted small">${esc(st.sku)}</span></p>
  <form data-f="mov"><div class="row" style="justify-content:center;margin:10px 0"><div class="stepper"><button type="button" data-a="movQtd" data-d="-1">−</button><input name="qtd" inputmode="numeric" value="${st.qtd || 1}"><button type="button" data-a="movQtd" data-d="1">+</button></div></div>
  <label class="f">Quem autorizou<input class="i" name="autorizou" value="${st.tipo === 'bonificacao' ? 'Indião' : ''}"></label>
  <label class="f">Observação<input class="i" name="obs" placeholder="${st.tipo === 'bonificacao' ? 'ex.: jogou na plateia, 2ª música' : ''}"></label>
  <button class="btn ok block">Lançar</button></form>`;
}
function shCargaPrev() {
  const st = S.sheet; const itens = Object.entries(st.carga).sort(); const pecas = itens.reduce((a, [, q]) => a + q, 0);
  return `<div class="row"><h3 class="grow">Conferir carga do PDF</h3><button class="iconbtn" data-a="fechar">✕</button></div>
  <p class="muted small">${esc(st.nome)}${st.pedido ? ' · pedido ' + esc(st.pedido) : ''}</p>
  <div class="kpis"><div class="kpi"><b>${pecas}</b><span>peças</span></div><div class="kpi"><b>${itens.length}</b><span>SKUs reconhecidos</span></div></div>
  ${st.linhasNota && st.linhasNota !== st.achados ? `<div class="warn" style="margin-top:12px">A nota tem ${st.linhasNota} linhas de item e reconheci ${st.achados}. Confira os itens que faltam ou atualize o catálogo.</div>` : ''}
  <div class="card" style="margin-top:12px">${itens.map(([s, q]) => `<div class="line"><div class="grow"><div style="font-weight:600">${esc(S.produtos.get(s)?.descricao || s)}</div><div class="muted small">${esc(s)}</div></div><b>${q}</b></div>`).join('')}</div>
  <p class="muted small">Compare com o total de peças do pedido no PDF antes de confirmar.</p>
  <div class="grid2"><button class="btn" data-a="fechar">Cancelar</button><button class="btn primary" data-a="usarCarga">Usar esta carga</button></div>`;
}
function shDespesa() {
  const l = lote(); const st = S.sheet; const cat = st.cat || CATS_DESP[0]; const pct = (st.tipo || (cat === 'Comissão sobre vendas' ? 'pct' : 'valor')) === 'pct';
  return `<div class="row"><h3 class="grow">Lançar despesa</h3><button class="iconbtn" data-a="fechar">✕</button></div><form data-f="despesa">
  <label class="f">Tipo<select class="i" name="cat" data-in="despCat">${CATS_DESP.map(c => `<option ${c === cat ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
  <label class="f">De qual show<select class="i" name="showId"><option value="">Todo o lote (rateio pela receita)</option>${(l.shows || []).map(s => `<option value="${s.id}" ${s.id === showAtual(l)?.id ? 'selected' : ''}>${esc(s.cidade)}/${s.uf} · ${fmtD(s.data)}</option>`).join('')}</select></label>
  <div class="grid2"><label class="f">Forma<select class="i" name="tipo" data-in="despTipo"><option value="valor" ${!pct ? 'selected' : ''}>Valor (R$)</option><option value="pct" ${pct ? 'selected' : ''}>% sobre a venda</option></select></label>
  <label class="f">${pct ? 'Percentual' : 'Valor (R$)'}<input class="i" name="valor" inputmode="decimal" required value="${pct && S.cfg.comissaoPct ? String(S.cfg.comissaoPct).replace('.', ',') : ''}"></label></div>
  <label class="f">Observação<input class="i" name="obs" placeholder="${cat === 'Comissão sobre vendas' ? 'ex.: vendedores do show' : 'ex.: 3 diárias × R$ 60'}"></label>
  <button class="btn ok block">Lançar</button></form>`;
}
function shAjuste() {
  const l = lote(); const F = fin(l); const st = S.sheet; const cat = CAT_AJ[st.cat || 'desconto'];
  const sd = saldos(l); const ret = l.retorno || {};
  const faltas = Object.entries(sd).map(([s, x]) => [s, ret[s] === undefined ? 0 : x.saldo - ret[s]]).filter(([, q]) => q > 0);
  return `<div class="row"><h3 class="grow">Justificar diferença</h3><button class="iconbtn" data-a="fechar">✕</button></div>
  <p class="muted small">Diferença sem justificativa: <b>${brl(F.pendente)}</b> (${F.pendente >= 0 ? 'entrou a mais' : 'entrou a menos'} que o lançado).</p>
  <form data-f="ajuste">
  <label class="f">Motivo<select class="i" name="cat" data-in="ajCat">${CATS_AJ.map(c => `<option value="${c.id}" ${c.id === cat.id ? 'selected' : ''}>${c.nome}</option>`).join('')}</select></label>
  ${cat.neutro ? '<p class="muted small">Só explica diferença entre formas (ex.: lançou Pix e foi débito). Não entra na soma.</p>' : `<label class="f">Efeito<select class="i" name="dir"><option value="mais" ${(cat.dir || (F.pendente >= 0 ? 'mais' : 'menos')) === 'mais' ? 'selected' : ''}>Entrou a mais que o lançado</option><option value="menos" ${(cat.dir || (F.pendente >= 0 ? 'mais' : 'menos')) === 'menos' ? 'selected' : ''}>Entrou a menos que o lançado</option></select></label>`}
  <label class="f">Valor (R$)<input class="i" name="valor" inputmode="decimal" required value="${st.valor ? String(st.valor.toFixed(2)).replace('.', ',') : Math.abs(F.pendente) >= .01 && !cat.neutro ? String(Math.abs(F.pendente).toFixed(2)).replace('.', ',') : ''}"></label>
  ${st.txId ? `<input type="hidden" name="txId" value="${esc(st.txId)}">` : ''}
  ${cat.sku && l.perdaExportada ? `<p class="small warn">A nota de perda já foi gerada em ${fmtDT(l.perdaExportada.ts)}: a peça continua na perda e o valor entra na venda por rateio.</p>` : ''}
  ${cat.sku && !l.perdaExportada ? `<div class="grid2"><label class="f">Peça que faltou (opcional)<select class="i" name="sku"><option value="">—</option>${faltas.map(([s, q]) => `<option value="${esc(s)}">${esc(s)} (faltam ${q})</option>`).join('')}</select></label><label class="f">Quantidade<input class="i" name="qtd" inputmode="numeric" value="1"></label></div>
    <p class="muted small">Com a peça informada, ela sai da perda e entra no pedido de venda.</p>` : ''}
  <label class="f">Observação<input class="i" name="obs" value="${esc(st.obs || '')}" placeholder="ex.: 2 bonés por R$ 200 no fim do show" ${cat.id === 'outro' ? 'required' : ''}></label>
  <button class="btn ok block">Lançar justificativa</button></form>`;
}
function shTexto() {
  const st = S.sheet;
  return `<h3>${esc(st.titulo)}</h3>${st.texto ? `<p class="muted">${esc(st.texto)}</p>` : ''}<form data-f="texto">
  ${st.semInput ? '<input type="hidden" name="v" value="ok">' : `<input class="i" style="width:100%;margin:10px 0" name="v" value="${esc(st.valor || '')}" ${st.tipo === 'num' ? 'inputmode="decimal"' : ''} placeholder="${esc(st.ph || '')}" ${st.obrig ? 'required' : ''} ${st.tipo === 'pin' ? 'type="password" inputmode="numeric" autocomplete="off"' : ''} autofocus>`}
  ${st.chips ? `<div class="chips">${st.chips.map(c => `<button type="button" class="chip" data-a="chipTexto" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
  <div class="grid2"><button type="button" class="btn" data-a="fechar">Cancelar</button><button class="btn ${st.perigo ? 'danger' : 'primary'}">${esc(st.ok || 'OK')}</button></div></form>`;
}
function perguntar(o) { return new Promise(res => { S.sheet = { k: 'texto', ...o, res }; renderSheet(); setTimeout(() => { const i = $('#sheet input[name=v]'); i && i.focus(); }, 60); }); }

// ---------- toast ----------
let toastT;
function toast(msg, undo, err) {
  $('#toast')?.remove(); clearTimeout(toastT);
  const t = document.createElement('div'); t.id = 'toast'; t.className = 'toast' + (err ? ' err' : '');
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button>Desfazer</button>' : ''}`; document.body.appendChild(t);
  if (undo) t.querySelector('button').onclick = () => { t.remove(); undo(); };
  toastT = setTimeout(() => t.remove(), undo ? 6000 : 3000);
}

// ---------- ações ----------
const A = {
  ir: e => { S.view = e.dataset.v; render(); if (S.view === 'config') checarPersist(); },
  voltar: () => { if (S.view === 'lote') { S.view = 'home'; S.loteId = null; } else S.view = 'home'; S.sheet = null; render(); },
  abrirLote: e => { S.loteId = e.dataset.id; S.view = 'lote'; S.tab = 'vender'; S.cart = []; S.cartDesc = 0; S.contagemRevelada = false; render(); wake(); },
  tab: e => { S.tab = e.dataset.t; S.contagemRevelada = lote().status === 'fechado'; render(); window.scrollTo(0, 0); },
  cat: e => { S.cat = e.dataset.c; render(); },
  todoCat: () => { S.todoCatalogo = !S.todoCatalogo; render(); },
  abrirModelo: e => { S.sheet = { k: 'modelo', m: e.dataset.m, modo: 'venda' }; renderSheet(); },
  fechar: () => { if (S.sheet?.res) S.sheet.res(null); S.sheet = null; render(); },
  add: async e => {
    const sku = skuFisico(e.dataset.s); const p = S.produtos.get(sku) || S.produtos.get(e.dataset.s); const l = lote(); const sd = saldos(l);
    const noCart = S.cart.filter(c => c.sku === sku).reduce((a, c) => a + c.qtd, 0);
    if ((sd[sku]?.saldo || 0) - noCart <= 0) {
      const ok = await perguntar({ titulo: 'Sem saldo na carga', texto: `${p.descricao}: a carga deste lote não tem mais essa peça. Se ela está na sua mão, confira o SKU. Vender mesmo assim?`, ok: 'Vender mesmo assim', ph: 'motivo (obrigatório)', obrig: true, perigo: true });
      if (!ok) { S.sheet = { k: 'modelo', m: modeloDe(p), modo: 'venda' }; renderSheet(); return; }
      S.cart.push({ sku, qtd: 1, preco: precoShow(p), semSaldo: ok }); S.sheet = { k: 'modelo', m: modeloDe(p), modo: 'venda' };
    } else {
      const it = S.cart.find(c => c.sku === sku && !c.semSaldo && c.preco === precoShow(p)); if (it) it.qtd++; else S.cart.push({ sku, qtd: 1, preco: precoShow(p) });
    }
    if (!precoShow(p)) toast('Produto sem preço: ajuste no carrinho', null, true);
    vibrate(15); render();
  },
  sheetCart: () => { S.sheet = { k: 'cart' }; renderSheet(); },
  qtd: e => { const c = S.cart[+e.dataset.i]; c.qtd += +e.dataset.d; if (c.qtd <= 0) S.cart.splice(+e.dataset.i, 1); if (!S.cart.length) { S.sheet = null; S.cartDesc = 0; } render(); },
  limparCart: () => { const bk = [S.cart, S.cartDesc]; S.cart = []; S.cartDesc = 0; S.sheet = null; render(); toast('Carrinho esvaziado', () => { [S.cart, S.cartDesc] = bk; render(); }); },
  precoItem: async e => { const c = S.cart[+e.dataset.i]; const v = await perguntar({ titulo: 'Preço desta peça', tipo: 'num', valor: String(c.preco).replace('.', ','), ok: 'Aplicar' }); if (v !== null && v !== undefined) c.preco = num(v); S.sheet = { k: 'cart' }; render(); },
  desconto: async () => {
    const sub = S.cart.reduce((a, c) => a + c.qtd * c.preco, 0);
    const v = await perguntar({ titulo: 'Desconto em R$', texto: `Subtotal ${brl(sub)}. Para %, digite ex.: 10%`, tipo: 'num', valor: S.cartDesc ? String(S.cartDesc).replace('.', ',') : '', ok: 'Próximo', chips: ['5%', '10%', '15%'] });
    if (v === null || v === undefined) { S.sheet = { k: 'cart' }; render(); return; }
    let d = String(v).includes('%') ? sub * num(String(v).replace('%', '')) / 100 : num(v); d = Math.min(Math.max(0, +d.toFixed(2)), sub);
    if (d > 0) { const m = await perguntar({ titulo: 'Motivo do desconto', ok: 'Aplicar', obrig: true, chips: ['Leva 2+', 'Peça com defeito', 'Equipe/parceiro', 'Negociação'] }); if (!m) { S.sheet = { k: 'cart' }; render(); return; } S.cartDescMotivo = m; }
    S.cartDesc = d; S.sheet = { k: 'cart' }; render();
  },
  cobrar: () => { if (!S.cart.length) return; if (S.cart.some(c => !c.preco)) { toast('Há peça sem preço. Toque no preço no carrinho.', null, true); S.sheet = { k: 'cart' }; render(); return; } S.pagamentos = []; S.sheet = { k: 'pagar' }; render(); },
  forma: e => {
    const f = e.dataset.f; const tot = S.cart.reduce((a, c) => a + c.qtd * c.preco, 0) - S.cartDesc; const falta = +(tot - S.pagamentos.reduce((a, p) => a + p.valor, 0)).toFixed(2);
    const valor = S.sheet.parcial != null ? Math.min(S.sheet.parcial, falta) : falta;
    if (f === 'dinheiro') { S.sheet = { k: 'pagar', forma: 'dinheiro', valor }; renderSheet(); bindRecebido(valor); return; }
    if (f === 'credito') { S.sheet = { k: 'pagar', forma: 'credito', valor }; renderSheet(); return; }
    if (f === 'outro') { perguntar({ titulo: 'Qual meio de pagamento?', texto: `${brl(valor)} fora da InfinitePay`, ph: 'ex.: Pix Sicoob', obrig: true, ok: 'Confirmar', chips: ['Pix Sicoob', 'Mercado Pago', 'Transferência', 'PicPay'] })
      .then(nome => { if (nome) S.pagamentos.push({ forma: 'outro', valor, nome }); S.sheet = { k: 'pagar' }; renderSheet(); }); return; }
    S.pagamentos.push({ forma: f, valor }); S.sheet = { k: 'pagar' }; vibrate(15); renderSheet();
  },
  parcelas: e => { S.pagamentos.push({ forma: 'credito', valor: S.sheet.valor, parcelas: +e.dataset.n }); S.sheet = { k: 'pagar' }; vibrate(15); renderSheet(); },
  recebido: e => { $('#recebido').value = String(e.dataset.v).replace('.', ','); $('#recebido').dispatchEvent(new Event('input')); },
  confDinheiro: () => { const v = S.sheet.valor; const rec = num($('#recebido').value) || v; if (rec < v - 0.001) { toast('Valor recebido menor que o devido', null, true); return; } S.pagamentos.push({ forma: 'dinheiro', valor: v, troco: +(rec - v).toFixed(2) }); S.sheet = { k: 'pagar' }; vibrate(15); renderSheet(); },
  volPag: () => { S.sheet = { k: 'pagar' }; renderSheet(); },
  rmPag: e => { S.pagamentos.splice(+e.dataset.i, 1); renderSheet(); },
  dividir: async () => { const v = await perguntar({ titulo: 'Quanto vai na 1ª forma?', tipo: 'num', ok: 'OK' }); S.sheet = { k: 'pagar', parcial: v ? num(v) : null }; renderSheet(); },
  finalizar: async () => {
    const l = lote(); const sh = showAtual(l); S.cfg.seqVenda = (S.cfg.seqVenda || 0) + 1; l.seq = S.cfg.seqVenda; saveCfg();
    const v = { id: uid(), num: l.seq, loteId: l.id, showId: sh?.id, ts: now(), itens: S.cart.map(c => ({ sku: c.sku, qtd: c.qtd, preco: c.preco, ...(c.semSaldo ? { semSaldo: c.semSaldo } : {}) })),
      desconto: S.cartDesc, descMotivo: S.cartDesc ? S.cartDescMotivo : '', pagamentos: S.pagamentos.map(p => ({ forma: p.forma, valor: p.valor, ...(p.parcelas ? { parcelas: p.parcelas } : {}), ...(p.nome ? { nome: p.nome } : {}) })),
      troco: S.pagamentos.reduce((a, p) => a + (p.troco || 0), 0), vendedor: S.cfg.vendedor, caixa: S.cfg.caixa, aparelho: S.cfg.aparelho, status: 'ok' };
    S.vendas.push(v); await DB.put('vendas', v);
    const bk = { cart: S.cart, d: S.cartDesc };
    S.cart = []; S.cartDesc = 0; S.pagamentos = []; S.sheet = null; vibrate([20, 40, 20]); render();
    toast(`Venda #${v.num} registrada · ${brl(totalVenda(v).liq)}`, async () => { v.status = 'cancelada'; v.motivoCanc = 'desfeita logo após o registro'; v.canceladaEm = now(); await DB.put('vendas', v); S.cart = bk.cart; S.cartDesc = bk.d; render(); });
  },
  cancelarVenda: async e => { const v = S.vendas.find(x => x.id === e.dataset.id); const m = await perguntar({ titulo: `Cancelar venda #${v.num}?`, texto: 'A venda fica no histórico como cancelada e as peças voltam ao saldo. Estorne na maquininha se foi cartão ou Pix.', ph: 'motivo (obrigatório)', obrig: true, ok: 'Cancelar venda', perigo: true, chips: ['Lançada errada', 'Cliente desistiu', 'Pagamento recusado'] }); S.sheet = null; if (!m) return render(); v.status = 'cancelada'; v.motivoCanc = m; v.canceladaEm = now(); v.canceladaPor = S.cfg.vendedor; await DB.put('vendas', v); render(); toast('Venda cancelada'); },
  sheetShow: () => { S.sheet = { k: 'show' }; renderSheet(); },
  usarShow: async e => { const l = lote(); l.showAtual = e.dataset.id; await saveLote(l); S.sheet = null; render(); toast('Show atual trocado'); },
  novoMov: e => { S.sheet = { k: 'mov', tipo: e.dataset.t }; renderSheet(); },
  movModelo: e => { S.sheet = { k: 'modelo', m: e.dataset.m, modo: 'mov', tipo: S.sheet.tipo }; renderSheet(); },
  pickMov: e => { S.sheet = { k: 'mov', tipo: S.sheet.tipo, sku: skuFisico(e.dataset.s) }; renderSheet(); },
  movQtd: e => { const i = $('#sheet input[name=qtd]'); i.value = Math.max(1, num(i.value) + +e.dataset.d); },
  cancelarMov: async e => { const m = S.movs.find(x => x.id === e.dataset.id); const r = await perguntar({ titulo: 'Cancelar lançamento?', ph: 'motivo', obrig: true, ok: 'Cancelar', perigo: true }); S.sheet = null; if (!r) return render(); m.status = 'cancelada'; m.motivoCanc = r; await DB.put('movs', m); render(); },
  chipTexto: e => { const i = $('#sheet input[name=v]'); i.value = e.dataset.v; },
  iniciarContagem: async () => { const l = lote(); const ok = await perguntar({ titulo: 'Travar vendas e começar a contagem?', texto: 'Depois disso, este lote não aceita vendas novas. Antes, junte aqui as vendas dos outros caixas ("Receber caixa" na tela inicial).', ok: 'Travar e contar', semInput: true }); S.sheet = null; if (!ok) return render(); l.status = 'contagem'; l.retorno ||= {}; await saveLote(l); render(); },
  ret: async e => { const l = lote(); if (l.status === 'aberto') { toast('Primeiro toque em "Travar vendas"', null, true); return; } l.retorno ||= {}; const s = e.dataset.s; l.retorno[s] = Math.max(0, (l.retorno[s] || 0) + +e.dataset.d); await saveLote(l); const inp = document.querySelector(`input[data-in=ret][data-s="${CSS.escape(s)}"]`); if (inp) inp.value = l.retorno[s]; vibrate(10); },
  revelar: () => { const l = lote(); if (l.status === 'aberto') { toast('Primeiro toque em "Travar vendas"', null, true); return; } S.contagemRevelada = true; render(); window.scrollTo(0, 0); },
  recontar: () => { S.contagemRevelada = false; render(); },
  perfil: () => { if (S.cfg.pinHash && gestor()) { Perfil.ate = 0; S.view = S.view === 'lote' ? 'lote' : 'home'; if (!ABAS_VENDEDOR.includes(S.tab)) S.tab = 'vender'; render(); toast('Modo vendedor'); } else entrarGestor(); },
  corrigirData: async e => { const l = lote(); const sh = showAtual(l); (l.historico ||= []).push({ ts: now(), acao: 'data do show corrigida', motivo: `${sh.cidade}: ${fmtD(sh.data)} → ${fmtD(e.dataset.d)}`, quem: S.cfg.vendedor });
    sh.data = e.dataset.d; await saveLote(l); render(); toast('Data do show corrigida'); },
  dataCerta: async e => { const l = lote(); showAtual(l).dataConferida = e.dataset.d; await saveLote(l); render(); },
  addOutro: async () => { const l = lote(); fin(l).f.outros.push({ nome: '', valor: 0 }); await saveLote(l); render(); },
  rmOutro: async e => { const l = lote(); fin(l).f.outros.splice(+e.dataset.i, 1); await saveLote(l); render(); },
  ajusteDeTx: e => { const a = analiseInfinite(lote()); const t = a?.semPdv.find(x => x.id + x.t === e.dataset.tx); if (!t) return;
    S.sheet = { k: 'ajuste', cat: 'venda_nr', valor: t.valor, obs: `${FORMA[t.forma]} ${fmtDT(t.t)} · ${t.term}`, txId: e.dataset.tx }; renderSheet(); },
  novaDesp: () => { S.sheet = { k: 'despesa' }; renderSheet(); },
  rmDesp: async e => { const l = lote(); const d = l.despesas[+e.dataset.i]; const ok = await perguntar({ titulo: 'Remover despesa?', texto: `${d.cat}: ${d.tipo === 'pct' ? d.valor + '%' : brl(d.valor)}`, ok: 'Remover', perigo: true, semInput: true }); S.sheet = null; if (!ok) return render(); l.despesas.splice(+e.dataset.i, 1); await saveLote(l); render(); },
  novoAjuste: () => { S.sheet = { k: 'ajuste', cat: fin(lote()).pendente < 0 ? 'desconto' : 'venda_nr' }; renderSheet(); },
  rmAjuste: async e => { const l = lote(); fin(l).f.ajustes.splice(+e.dataset.i, 1); await saveLote(l); render(); },
  concluirFin: async () => { const l = lote(); const F = fin(l); if (!F.pronto) return;
    const quem = await perguntar({ titulo: 'Concluir a conferência financeira?', texto: `Venda no pedido do Tiny: ${brl(F.vendaAjustada)}. Recebido: ${brl(F.realTotal)}.`, ph: 'nome de quem conferiu', obrig: true, ok: 'Concluir' });
    S.sheet = null; if (!quem) return render(); F.f.concluido = true; F.f.concluidoEm = now(); F.f.concluidoPor = quem; await saveLote(l); render(); toast('Conferência financeira concluída'); },
  reabrirFin: async () => { const l = lote(); const m = await perguntar({ titulo: 'Reabrir a conferência?', ph: 'motivo', obrig: true, ok: 'Reabrir', perigo: true }); S.sheet = null; if (!m) return render();
    (l.historico ||= []).push({ ts: now(), acao: 'conferência financeira reaberta', motivo: m, quem: S.cfg.vendedor }); fin(l).f.concluido = false; await saveLote(l); render(); },
  destravar: async () => { const l = lote(); if (l.status !== 'contagem') return;
    const n = Object.keys(l.retorno || {}).length;
    const m = await perguntar({ titulo: 'Destravar as vendas?', texto: `O lote volta a aceitar vendas e a contagem é zerada${n ? ` (${n} SKUs já contados serão apagados)` : ''}. Use se travou por engano ou se ainda vai vender.`, ph: 'motivo (obrigatório)', obrig: true, ok: 'Destravar e zerar', perigo: true, chips: ['Travou por engano', 'Ainda vai vender', 'Recomeçar a contagem'] });
    S.sheet = null; if (!m) return render();
    (l.historico ||= []).push({ ts: now(), acao: 'destravou vendas', motivo: m, quem: S.cfg.vendedor, contadosApagados: n });
    l.status = 'aberto'; l.retorno = {}; l.obsDif = {}; await saveLote(l);
    S.contagemRevelada = false; S.tab = 'vender'; render(); toast('Vendas destravadas e contagem zerada'); },
  obsChip: async e => { const l = lote(); l.obsDif ||= {}; const s = e.dataset.s; const atual = l.obsDif[s] || ''; l.obsDif[s] = atual && !atual.includes(e.dataset.v) ? atual + '; ' + e.dataset.v : e.dataset.v; await saveLote(l); render(); },
  esgotados: () => { S.esgotados = !S.esgotados; render(); },
  maisShow: () => { const box = $('#shows'); const bl = box.querySelectorAll('.showbloco'); const ult = bl[bl.length - 1];
    const d = new Date((ult.querySelector('[name=data]').value || today()) + 'T12:00'); d.setDate(d.getDate() + 1);
    box.insertAdjacentHTML('beforeend', blocoShow(bl.length + 1, d.toISOString().slice(0, 10), ult.querySelector('[name=uf]').value)); box.lastElementChild.querySelector('[name=cidade]').focus(); },
  rmShow: e => { e.closest('.showbloco').remove(); $('#shows').querySelectorAll('.showbloco h2').forEach((h, i) => h.textContent = 'Show ' + (i + 1)); },
  usarCarga: async () => { const st = S.sheet; const l = lote(); if (st.pedido && !l.pedido) l.pedido = st.pedido; await aplicarCarga(l, st.carga, st.nome); S.sheet = null; render(); toast(`Carga: ${Object.values(st.carga).reduce((a, b) => a + b, 0)} peças em ${Object.keys(st.carga).length} SKUs`); },
  fecharLote: async () => { const l = lote(); const sd = saldos(l); const ret = l.retorno || {};
    const semObs = Object.keys(sd).filter(s => (sd[s].carga || sd[s].vendido || sd[s].mov) && (ret[s] ?? 0) - sd[s].saldo !== 0 && !((l.obsDif || {})[s] || '').trim());
    if (semObs.length) { toast(`Falta observação em ${semObs.length} divergência(s)`, null, true); return; }
    const quem = await perguntar({ titulo: 'Fechar o lote?', texto: 'Fechado, o lote não aceita mais vendas, bonificações nem contagem. Gere o PDF em seguida.', ph: 'nome de quem conferiu', obrig: true, ok: 'Fechar lote', perigo: true }); S.sheet = null; if (!quem) return render(); l.status = 'fechado'; l.fechadoEm = now(); l.fechadoPor = quem; await saveLote(l); S.tab = 'relatorio'; render(); toast('Lote fechado'); },
  pdf: () => { $('#print').innerHTML = relatorioHTML(lote()); setTimeout(() => window.print(), 50); },
  csvTiny: () => csvTiny(lote()),
  tinyCsv: e => csvTinyPedido(lote(), e.dataset.t),
  exportarCaixa: () => { S.sheet = null; exportarCaixa(lote()); },
  importarCaixa: () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.onchange = () => i.files[0] && receberCaixa(i.files[0]); i.click(); },
  contarCarga: async () => { const l = lote(); l.carga = {}; l.cargaManual = true; S.todoCatalogo = true; await saveLote(l); toast('Toque no produto, escolha cor e tamanho e informe a quantidade'); A.cargaManual(); },
  cargaManual: () => { S.sheet = { k: 'mov', tipo: '__carga' }; MOV.__carga = 'Carga'; renderSheet(); },
  precoModelo: async e => { const id = e.dataset.m; const ps = [...S.produtos.values()].filter(p => modeloDe(p) === id); const v = await perguntar({ titulo: 'Preço de show', texto: nomeModelo(ps[0]), tipo: 'num', valor: ps[0].precoShow ? String(ps[0].precoShow).replace('.', ',') : '', ph: 'vazio = preço do Tiny', ok: 'Salvar' }); S.sheet = null; if (v !== null && v !== undefined) { ps.forEach(p => p.precoShow = num(v) || 0); await DB.bulk('produtos', ps); } render(); },
  baixarFotos: () => baixarFotos(),
  sincAgora: async () => { toast('Sincronizando…'); await Sinc.ciclo(true); toast(Sinc.erro ? 'Erro: ' + Sinc.erro : `Sincronizado · ${Sinc.nPend()} pendentes`, null, !!Sinc.erro); if (S.view === 'config') render(); },
  enviarConfig: () => { const abertos = S.lotes.filter(l => l.status !== 'fechado'); const ids = new Set(abertos.map(l => l.id));
    const pac = { tipo: 'pacote', versao: 1, em: now(), de: S.cfg.caixa, produtos: [...S.produtos.values()].map(({ _rot, ...p }) => p), tabela: S.tabela, tabelaInfo: S.tabelaInfo,
      custos: S.custos, custosInfo: S.custosInfo, cfg: { cfopBonif: S.cfg.cfopBonif, cfopPerda: S.cfg.cfopPerda, taxas: S.cfg.taxas, das: S.cfg.das, dasRef: S.cfg.dasRef, comissaoPct: S.cfg.comissaoPct, pinHash: S.cfg.pinHash || '', sincUrl: S.cfg.sincUrl || '', sincChave: S.cfg.sincChave || '' },
      lotes: abertos, vendas: S.vendas.filter(v => ids.has(v.loteId)), movs: S.movs.filter(m => ids.has(m.loteId)) };
    baixar(`pdv-shows-configuracao-${today()}.json`, JSON.stringify(pac), 'application/json'); },
  backupTudo: () => baixar(`pdv-shows-backup-${today()}.json`, JSON.stringify({ tipo: 'backup', versao: 1, em: now(), produtos: [...S.produtos.values()], lotes: S.lotes, vendas: S.vendas, movs: S.movs }), 'application/json'),
};

// movimento de carga manual reaproveita o sheet de movimentos
async function salvarMov(fd) {
  const l = lote(); const st = S.sheet; const qtd = Math.max(1, Math.round(num(fd.get('qtd'))));
  if (st.tipo === '__carga') { l.carga[st.sku] = (l.carga[st.sku] || 0) + qtd; await saveLote(l); S.sheet = { k: 'mov', tipo: '__carga' }; render(); toast(`Carga: +${qtd} ${st.sku}`); return; }
  const m = { id: uid(), loteId: l.id, showId: showAtual(l)?.id, ts: now(), tipo: st.tipo, sku: st.sku, qtd, autorizou: fd.get('autorizou') || '', obs: fd.get('obs') || '', quem: S.cfg.vendedor, caixa: S.cfg.caixa, status: 'ok' };
  S.movs.push(m); await DB.put('movs', m); S.sheet = null; vibrate(15); render();
  toast(`${MOV[m.tipo]}: ${qtd}× ${m.sku}`, async () => { m.status = 'cancelada'; m.motivoCanc = 'desfeito'; await DB.put('movs', m); render(); });
}

// ---------- formulários e inputs ----------
document.addEventListener('submit', async ev => {
  const f = ev.target; const k = f.dataset.f; if (!k) return; ev.preventDefault(); const fd = new FormData(f);
  if (k === 'texto') { const r = S.sheet.res; const v = fd.get('v'); S.sheet = null; r && r(v); return; }
  if (k === 'cfg' && !fd.has('cfopBonif')) { S.cfg.vendedor = fd.get('vendedor').trim(); S.cfg.caixa = fd.get('caixa').trim(); S.cfg.tema = fd.get('tema'); await saveCfg(); S.view = 'home'; render(); toast('Salvo'); return; }
  if (k === 'cfg') { const pn = (fd.get('pinNovo') || '').trim();
    if (pn) { if (!/^\d{4,8}$/.test(pn) || pn !== (fd.get('pinConf') || '').trim()) { toast('PIN: 4 a 8 números, iguais nos dois campos', null, true); return; } S.cfg.pinHash = await hashPin(pn); Perfil.ate = Date.now() + 15 * 60e3; }
    S.cfg.vendedor = fd.get('vendedor').trim(); S.cfg.caixa = fd.get('caixa').trim(); S.cfg.tema = fd.get('tema'); S.cfg.cfopBonif = fd.get('cfopBonif').trim(); S.cfg.cfopPerda = fd.get('cfopPerda').trim(); if (num(fd.get('das')) !== S.cfg.das) S.cfg.dasRef = `informado em ${fmtDT(now())} por ${S.cfg.vendedor || '—'}`; S.cfg.das = num(fd.get('das')); S.cfg.comissaoPct = num(fd.get('comissaoPct')); Object.keys(S.cfg.taxas).forEach(k => { if (fd.get('tx_' + k) !== null) S.cfg.taxas[k] = num(fd.get('tx_' + k)); });
    const urlAntes = S.cfg.sincUrl; S.cfg.sincUrl = (fd.get('sincUrl') || '').trim(); S.cfg.sincChave = (fd.get('sincChave') || '').trim(); await saveCfg();
    if (Sinc.ativo() && S.cfg.sincUrl !== urlAntes) { // servidor novo: sobe tudo o que existe neste aparelho
      S.lotes.forEach(l => Sinc.st.pend['lote:' + l.id] = ++Sinc.cont); S.vendas.forEach(v => Sinc.st.pend['venda:' + v.id] = ++Sinc.cont); S.movs.forEach(m => Sinc.st.pend['mov:' + m.id] = ++Sinc.cont);
      if (Object.keys(S.tabela).length) Sinc.st.pend['tabela:atual'] = ++Sinc.cont; if (S.produtos.size) { Sinc.st.pend['catalogo:atual'] = ++Sinc.cont; Sinc.st.catVer ||= now(); }
      Sinc.st.seq = 0; Sinc.salvar(); }
    Sinc.ciclo(); S.view = 'home'; render(); toast('Salvo'); }
  if (k === 'novoLote') {
    if (!S.cfg.vendedor) { S.cfg.vendedor = fd.get('resp'); saveCfg(); }
    const cs = fd.getAll('cidade'), us = fd.getAll('uf'), ds = fd.getAll('data'), es = fd.getAll('evento');
    const shows = cs.map((c, i) => ({ id: uid(), cidade: c.trim(), uf: us[i], data: ds[i], evento: (es[i] || '').trim() })).sort((a, b) => a.data.localeCompare(b.data));
    const l = { id: uid(), pedido: fd.get('pedido').trim(), resp: fd.get('resp').trim(), equipe: fd.get('equipe').trim(), shows, showAtual: shows[0].id, carga: {}, retorno: {}, obsDif: {}, status: 'aberto', criado: now(), seq: 0 };
    S.lotes.push(l); await saveLote(l); S.loteId = l.id; S.view = 'lote'; S.tab = 'vender'; render();
  }
  if (k === 'novoShow') { const l = lote(); const sh = { id: uid(), cidade: fd.get('cidade').trim(), uf: fd.get('uf'), data: fd.get('data'), evento: fd.get('evento').trim() }; l.shows.push(sh); l.showAtual = sh.id; await saveLote(l); S.sheet = null; render(); toast(`Agora vendendo em ${sh.cidade}/${sh.uf}`); }
  if (k === 'mov') salvarMov(fd);
  if (k === 'despesa') { const l = lote(); const d = { id: uid(), cat: fd.get('cat'), showId: fd.get('showId') || '', tipo: fd.get('tipo'), valor: Math.abs(num(fd.get('valor'))), obs: (fd.get('obs') || '').trim(), quem: S.cfg.vendedor, ts: now() };
    if (!d.valor) { toast('Informe o valor', null, true); return; } (l.despesas ||= []).push(d); await saveLote(l); S.sheet = null; render(); toast('Despesa lançada'); }
  if (k === 'ajuste') { const l = lote(); const cat = CAT_AJ[fd.get('cat')]; const a = { id: uid(), cat: cat.id, dir: cat.neutro ? 'mais' : fd.get('dir'), valor: Math.abs(num(fd.get('valor'))), obs: (fd.get('obs') || '').trim(), quem: S.cfg.vendedor, ts: now() };
    if (cat.sku && fd.get('sku')) { a.sku = fd.get('sku'); a.qtd = Math.max(1, Math.round(num(fd.get('qtd')))); }
    if (fd.get('txId')) a.txId = fd.get('txId');
    if (!a.valor) { toast('Informe o valor', null, true); return; }
    fin(l).f.ajustes.push(a); await saveLote(l); S.sheet = null; render(); toast('Justificativa lançada'); }
});
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-a]'); if (el) { ev.preventDefault(); const fn = A[el.dataset.a]; if (!fn) return;
    if (S.cfg.pinHash && gestor()) Perfil.ate = Date.now() + 15 * 60e3; // atividade renova a sessão do gestor
    if (precisaGestor(el) && !gestor()) { entrarGestor().then(ok => ok && fn(el, ev)); return; }
    fn(el, ev); return; }
  if (ev.target.classList.contains('scrim')) A.fechar();
});
document.addEventListener('input', async ev => {
  const t = ev.target;
  if (t.dataset.in === 'busca') { S.busca = t.value; const pos = t.selectionStart; render(); const n = $('input[data-in=busca]'); n.focus(); n.setSelectionRange(pos, pos); }
  if (t.dataset.in === 'obsDif') { const l = lote(); l.obsDif ||= {}; l.obsDif[t.dataset.s] = t.value; await saveLote(l); return; }
  if (t.dataset.in === 'ret') { const l = lote(); if (l.status === 'aberto') { t.value = ''; toast('Primeiro toque em "Travar vendas"', null, true); return; } l.retorno ||= {}; if (t.value === '') delete l.retorno[t.dataset.s]; else l.retorno[t.dataset.s] = Math.max(0, Math.round(num(t.value))); await saveLote(l); }
});
document.addEventListener('change', async ev => {
  const t = ev.target;
  if (t.dataset.in === 'despCat') { S.sheet = { k: 'despesa', cat: t.value }; renderSheet(); return; }
  if (t.dataset.in === 'despTipo') { S.sheet = { ...S.sheet, k: 'despesa', cat: document.querySelector('#sheet [name=cat]').value, tipo: t.value }; renderSheet(); return; }
  if (t.dataset.in === 'ajCat') { S.sheet = { ...S.sheet, k: 'ajuste', cat: t.value }; renderSheet(); return; }
  if (['finReal', 'outroNome', 'outroValor'].includes(t.dataset.in)) { const l = lote(); const F = fin(l);
    if (t.dataset.in === 'finReal') { if (t.value.trim() === '') delete F.f.real[t.dataset.f]; else F.f.real[t.dataset.f] = num(t.value); }
    if (t.dataset.in === 'outroNome') F.f.outros[+t.dataset.i].nome = t.value.trim();
    if (t.dataset.in === 'outroValor') F.f.outros[+t.dataset.i].valor = num(t.value);
    await saveLote(l); render(); return; }
  const f = t.files && t.files[0]; if (!f) return;
  // vendedor importa só a primeira carga do lote (pedido do Tiny); trocar carga e os demais arquivos são do gestor
  const cargaInicial = t.dataset.in === 'carga' && lote() && !Object.keys(lote().carga || {}).length;
  if (!gestor() && !cargaInicial) { t.value = ''; toast('Importação é função do gestor', null, true); entrarGestor(); return; }
  try {
    if (t.dataset.in === 'catalogo') { const r = await importarCatalogo(f); toast(`${r.n} SKUs importados (${r.novos} novos)`); render(); }
    if (t.dataset.in === 'carga' && /\.pdf$/i.test(f.name)) { await lerCargaPdf(f, lote()); t.value = ''; return; }
    if (t.dataset.in === 'carga') { const r = await importarCarga(f, lote()); toast(`Carga: ${r.pecas} peças em ${r.linhas} SKUs${r.semCadastro ? ` · ${r.semCadastro} sem cadastro` : ''}`); render(); }
    if (t.dataset.in === 'custos') { const n = await importarCustos(f); toast(`${n} custos oficiais importados`); render(); }
    if (t.dataset.in === 'tabela') { const n = await importarTabela(f); const batem = Object.keys(S.tabela).filter(k => S.produtos.has(k)).length;
      toast(S.produtos.size ? `Tabela Shows e Eventos: ${n} preços · ${batem} batem com o catálogo` : `Tabela salva (${n} preços). Importe o catálogo para ver os produtos.`); render(); }
    if (t.dataset.in === 'infinite') { await lerInfinite(f, lote()); render(); }
  } catch (e) { console.error(e); toast(e.message || 'Não consegui ler o arquivo', null, true); }
  t.value = '';
});
function bindRecebido(v) {
  setTimeout(() => { const i = $('#recebido'); if (!i) return; i.focus(); i.addEventListener('input', () => { const r = num(i.value); $('#trocoBox b').textContent = brl(Math.max(0, r - v)); }); }, 50);
}

// ---------- InfinitePay ----------
async function lerInfinite(file, l) {
  const abas = await lerPlanilha(file); const aba = abas.find(a => a.linhas.length && col(a.linhas[0], k => k.includes('meio')) && col(a.linhas[0], k => k.startsWith('valor')));
  if (!aba) throw new Error('Não achei as colunas "Meio" e "Valor (R$)" do extrato da InfinitePay.');
  const r0 = aba.linhas[0]; const c = (...t) => col(r0, ...t);
  const k = { meio: c(k => k === 'meio - meio', k => k.includes('meio') && !k.includes('bandeira') && !k.includes('parcela')), band: c(k => k.includes('bandeira')), parc: c(k => k.includes('parcela')),
    orig: c(k => k === 'tipo - origem'), dados: c(k => k.includes('dados adicionais')), st: c(k => k === 'status'), val: c(k => k.startsWith('valor')), liq: c(k => k.startsWith('liquido') || k.startsWith('lquido') || k.includes('quido')),
    dt: c(k => k.startsWith('data')), nome: c(k => k === 'origem - nome'), id: c(k => k === 'identificador') };
  const dt = x => { if (x instanceof Date) return +x; if (typeof x === 'number') return Math.round((x - 25569) * 864e5) + new Date().getTimezoneOffset() * 6e4; const m = String(x).match(/(\d{2})\/(\d{2})\/(\d{4})[ T]?(\d{2})?:?(\d{2})?/); if (m) return +new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)); return +new Date(x); };
  // janela do lote: do meio-dia do primeiro show até o meio-dia seguinte ao último show. A madrugada (show que passa da
  // meia-noite) entra no lote certo, e um show que começa à noite no mesmo dia em que outro terminou de madrugada fica
  // no lote dele. Vendas do PDV fora disso ampliam a janela.
  const ts = vendasLote(l).map(v => +new Date(v.ts)).sort((a, b) => a - b); const ds = (l.shows || []).map(s => s.data).filter(Boolean).sort();
  let de = Infinity, ate = -Infinity;
  if (ds.length) { de = +new Date(ds[0] + 'T00:00') + CORTE_H * 3600e3; ate = +new Date(ds[ds.length - 1] + 'T00:00') + 864e5 + CORTE_H * 3600e3 - 1; }
  if (ts.length) { de = Math.min(de, ts[0] - 3 * 3600e3); ate = Math.max(ate, ts[ts.length - 1] + 3 * 3600e3); }
  if (!isFinite(de)) { de = 0; ate = Infinity; }
  const formaDe = m => m.startsWith('pix') ? 'pix' : m.startsWith('cr') ? 'credito' : m.startsWith('d') ? 'debito' : null;
  const txs = []; let fora = 0;
  aba.linhas.forEach(r => {
    const t = k.dt ? dt(r[k.dt]) : 0; if (k.dt && (t < de || t > ate)) { fora++; return; }
    const forma = formaDe(norm(r[k.meio])); if (!forma) return;
    const valor = num(r[k.val]); const liq = k.liq ? num(r[k.liq]) : valor;
    const dados = String(r[k.dados] || '').replace(/^'/, '').trim();
    const origem = String(r[k.orig] || '').trim(); const serial = (dados.match(/NS:\s*(\S+)/) || [])[1]; const mv = (dados.match(/MV:\s*(.+)/) || [])[1];
    const term = origem.toLowerCase().startsWith('maquin') ? `Maquininha …${(serial || '').slice(-4)}` : origem.toLowerCase().includes('tap') ? `InfiniteTap · ${titulo(mv || '?')}` : `Pix na conta${mv ? ' · ' + titulo(mv) : ''}`;
    const parc = String(r[k.parc] || '').toLowerCase().includes('vista') ? 1 : (parseInt(r[k.parc]) || 1);
    txs.push({ t: new Date(t).toISOString(), forma, band: String(r[k.band] || '').toLowerCase(), parc, origem, term, status: norm(r[k.st]), valor, liq, taxa: +(valor - liq).toFixed(2), id: String(r[k.id] || ''), nome: String(r[k.nome] || '') });
  });
  const aprov = txs.filter(x => x.status.startsWith('aprov'));
  const formas = {}; aprov.forEach(x => formas[x.forma] = (formas[x.forma] || 0) + x.valor);
  S.infinite = { loteId: l.id, formas, n: aprov.length, de: new Date(de || Date.now()).toISOString(), ate: isFinite(ate) ? new Date(ate).toISOString() : now(), txs, fora, arq: file.name };
  l.conferenciaInfinite = S.infinite; await saveLote(l);
  toast(`${aprov.length} transações aprovadas no período do lote (${txs.length - aprov.length} negadas/canceladas, ${fora} fora do período)`);
}
// hora que separa uma noite de show da seguinte (transação antes disso pertence ao show da véspera)
const CORTE_H = 12;
const titulo = s => String(s).toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()).trim();
const taxaEst = p => p.forma === 'debito' ? S.cfg.taxas.debito : p.forma === 'credito' ? (S.cfg.taxas['c' + Math.min(6, p.parcelas || 1)] || S.cfg.taxas.c1) : 0;
// análise do extrato x PDV: totais por forma, bandeira, terminal, parcelas, show e conciliação venda a venda
function analiseInfinite(l) {
  const inf = l.conferenciaInfinite; if (!inf || !inf.txs) return null;
  const ap = inf.txs.filter(x => x.status.startsWith('aprov'));
  const soma = (arr, chave) => { const o = {}; arr.forEach(x => { const c = chave(x); const a = o[c] ||= { n: 0, valor: 0, liq: 0, taxa: 0 }; a.n++; a.valor += x.valor; a.liq += x.liq; a.taxa += x.taxa; }); return o; };
  const cartoes = ap.filter(x => x.forma !== 'pix');
  // show da transação: antes do meio-dia conta para a noite anterior; pega o show mais recente até 1 dia antes
  const showDe = x => { const d = new Date(+new Date(x.t) - CORTE_H * 3600e3); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); const dia = d.toISOString().slice(0, 10);
    const s = (l.shows || []).filter(s => s.data && s.data <= dia && (+new Date(dia) - +new Date(s.data)) <= 864e5).sort((a, b) => b.data.localeCompare(a.data))[0];
    return s ? `${s.cidade}/${s.uf}` : `fora dos shows (${fmtD(dia)})`; };
  // conciliação: cada pagamento do PDV (exceto dinheiro) com a transação de mesma forma e valor mais próxima no tempo (até 30 min)
  const pags = []; vendasLote(l).forEach(v => v.pagamentos.filter(p => !FORA_INFINITE.includes(p.forma)).forEach(p => pags.push({ num: v.num, t: +new Date(v.ts), forma: p.forma, valor: p.valor, parcelas: p.parcelas || 1 })));
  const livre = ap.map(x => ({ ...x, tt: +new Date(x.t), usado: false })); const semTx = [];
  pags.sort((a, b) => a.t - b.t).forEach(p => {
    let best = null; livre.forEach(x => { if (x.usado || x.forma !== p.forma || Math.abs(x.valor - p.valor) > 0.01) return; const d = Math.abs(x.tt - p.t); if (d <= 30 * 60e3 && (!best || d < Math.abs(best.tt - p.t))) best = x; });
    if (best) best.usado = true; else semTx.push(p);
  });
  const semPdv = livre.filter(x => !x.usado);
  // forma + bandeira (ex.: "Crédito · Mastercard"): é como o contas a receber do Tiny é baixado (líquido = bruto − taxa)
  const formaBand = x => x.forma === 'pix' ? 'Pix' : `${FORMA[x.forma]} · ${titulo(x.band || 'sem bandeira')}`;
  return { ap, porForma: soma(ap, x => x.forma), porBand: soma(cartoes, x => x.band || '—'), porFormaBand: soma(ap, formaBand), porTerm: soma(ap, x => x.term), porParc: soma(ap.filter(x => x.forma === 'credito'), x => x.parc + 'x'),
    porShow: soma(ap, showDe), taxa: ap.reduce((a, x) => a + x.taxa, 0), bruto: ap.reduce((a, x) => a + x.valor, 0), liq: ap.reduce((a, x) => a + x.liq, 0),
    brutoCartao: cartoes.reduce((a, x) => a + x.valor, 0), negadas: inf.txs.filter(x => !x.status.startsWith('aprov')), semTx, semPdv, conciliadas: pags.length - semTx.length, pags: pags.length };
}
function taxasPdv(l) { let t = 0; vendasLote(l).forEach(v => v.pagamentos.forEach(p => t += p.valor * taxaEst(p) / 100)); return t; }

// ---------- exportações ----------
function baixar(nome, conteudo, tipo) {
  const b = new Blob([conteudo], { type: tipo }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nome; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  if (navigator.canShare) { try { const f = new File([b], nome, { type: tipo }); if (navigator.canShare({ files: [f] })) navigator.share({ files: [f], title: nome }).catch(() => { }); } catch (e) { } }
}
function nomeArq(l) { return (l.pedido ? 'pedido-' + l.pedido : 'lote') + '-' + (l.shows || []).map(s => norm(s.cidade).replace(/\s+/g, '-')).join('_').slice(0, 60); }
function csvTiny(l) {
  const sd = saldos(l); const ret = l.retorno || {};
  const br = v => v.toFixed(2).replace('.', ',');
  const L = [['ID', 'Código (SKU)', 'Descrição', 'Estoque Inicial', 'Venda (qtd)', 'Venda preço médio', 'Venda total', `Bonificação (qtd) CFOP ${S.cfg.cfopBonif}`, `Perda (qtd) CFOP ${S.cfg.cfopPerda}`, 'Sobra (qtd)', 'Retorno ao estoque', 'Custo unit.', 'Observação da divergência']];
  Object.entries(sd).filter(([, x]) => x.carga || x.vendido || x.mov).sort().forEach(([s, x]) => { const p = S.produtos.get(s) || {}; const fin = ret[s]; const dif = fin === undefined ? 0 : fin - x.saldo;
    L.push([p.id || '', s, p.descricao || '', x.carga, x.vendido, x.vendido ? br(x.valor / x.vendido) : '', br(x.valor), x.mov, dif < 0 ? -dif : 0, dif > 0 ? dif : 0, fin ?? '', custoDe(s) ? br(custoDe(s)) : '', (l.obsDif || {})[s] || '']); });
  baixar(nomeArq(l) + '.csv', '﻿' + L.map(r => r.map(c => /[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}
// Três arquivos no layout "importar pedidos" do Tiny: venda (só o vendido, preço médio real), bonificação e perda (a custo).
const CAB_TINY = ['ID', 'Número do pedido', 'Data', 'Data prevista', 'ID contato', 'Nome do contato*', 'Tipo de Pessoa', 'CPF/CNPJ', 'RG/IE', 'CEP', 'Município', 'UF', 'Endereço', 'Endereço Nro', 'Complemento', 'Bairro', 'Fone', 'Celular', 'e-mail', 'Desconto pedido (% ou valor)', 'Frete', 'Observações', 'Situação', 'ID produto', 'Descrição', 'Quantidade', 'Valor unitário', 'Desconto item %', 'Código de rastreamento', 'Número da ordem de compra', 'Vendedor', 'Despesas', 'Desconto do pedido rateado', 'Frete pedido rateado', 'Despesas pedido rateado', 'Destinatário', 'CPF/CNPJ entrega', 'CEP entrega', 'Município entrega', 'UF entrega', 'Endereço entrega', 'Endereço Nro entrega', 'Complemento entrega', 'Bairro entrega', 'Fone entrega', 'Código (SKU)'];
function csvTinyPedido(l, tipo) {
  if (tipo === 'perda' && l.status !== 'fechado') { toast('A perda sai depois da contagem física: feche o lote na aba Contagem', null, true); S.tab = 'contagem'; render(); return; }
  // a perda é o que continua faltando depois da auditoria de vendas: venda achada no extrato tira a peça da perda
  if (tipo === 'perda' && !fin(l).f.concluido) { toast('A perda sai depois da conferência financeira: vendas achadas no extrato ainda podem tirar peças da perda', null, true); S.tab = 'financeiro'; render(); return; }
  if (tipo === 'venda' && !fin(l).f.concluido) { toast('Conclua a conferência financeira antes de gerar a venda', null, true); S.tab = 'financeiro'; render(); return; }
  const sd = saldos(l); const ret = l.retorno || {}; const c = l.contatoTiny || { nome: 'Shows e Eventos' }; const aj = baixasAjustadas(l);
  const br = v => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',');
  const shows = (l.shows || []).map(s => `${s.cidade}/${s.uf} ${fmtD(s.data)}`).join('; ');
  const obs = { venda: `PDV Shows - venda do pedido ${l.pedido || ''} - ${shows}`, bonif: `PDV Shows - BONIFICACAO CFOP ${S.cfg.cfopBonif} - pedido ${l.pedido || ''} - ${shows}`, perda: `PDV Shows - PERDA NA CONTAGEM CFOP ${S.cfg.cfopPerda} - pedido ${l.pedido || ''} - ${shows}` }[tipo];
  const linhas = [];
  Object.entries(aj).sort().forEach(([s, it]) => {
    const p = S.produtos.get(s) || {};
    let q = 0, v = 0;
    if (tipo === 'venda') { q = it.q; v = it.q ? it.valor / it.q : 0; } // preço médio real, depois da conferência financeira
    if (tipo === 'bonif') { q = it.bonif; v = custoDe(s); }
    if (tipo === 'perda') { q = it.perda; v = custoDe(s); }
    if (!q) return;
    const L = Object.fromEntries(CAB_TINY.map(k => [k, '']));
    Object.assign(L, { 'ID': '0', 'Data': new Date().toLocaleDateString('pt-BR'), 'ID contato': '0', 'Nome do contato*': c.nome, 'Tipo de Pessoa': c.tipo, 'CPF/CNPJ': c.doc, 'RG/IE': c.ie, 'CEP': c.cep, 'Município': c.mun, 'UF': c.uf,
      'Endereço': c.end, 'Endereço Nro': c.nro, 'Complemento': c.compl, 'Bairro': c.bairro, 'Desconto pedido (% ou valor)': '0', 'Frete': '0', 'Observações': obs, 'Situação': 'Em aberto',
      'ID produto': p.id || '0', 'Descrição': p.descricao || s, 'Quantidade': String(q), 'Valor unitário': br(v), 'Desconto item %': '0', 'Vendedor': '', 'Despesas': '0',
      'Desconto do pedido rateado': '0', 'Frete pedido rateado': '0', 'Despesas pedido rateado': '0', 'Código (SKU)': s });
    linhas.push(CAB_TINY.map(k => L[k]));
  });
  if (!linhas.length) { toast(tipo === 'venda' ? 'Nenhuma venda no lote' : tipo === 'bonif' ? 'Nenhuma bonificação no lote' : 'Nenhuma perda na contagem'); return; }
  if (tipo !== 'venda' && linhas.some(r => r[CAB_TINY.indexOf('Valor unitário')] === '0,00')) toast('Há SKU sem custo no catálogo: valor zerado no arquivo', null, true);
  const q = c => /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c;
  if (tipo === 'perda' && !l.perdaExportada) { l.perdaExportada = { ts: now(), por: S.cfg.vendedor, pecas: linhas.reduce((a, r) => a + num(r[CAB_TINY.indexOf('Quantidade')]), 0) }; saveLote(l); }
  baixar(`tiny-${tipo}-${nomeArq(l)}.csv`, [CAB_TINY, ...linhas].map(r => r.map(q).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
function exportarCaixa(l) {
  const pac = { tipo: 'caixa', versao: 1, em: now(), de: S.cfg.caixa, lote: l, vendas: S.vendas.filter(v => v.loteId === l.id), movs: S.movs.filter(m => m.loteId === l.id),
    produtos: [...S.produtos.values()].filter(p => (l.carga || {})[p.sku] !== undefined) };
  baixar(`${nomeArq(l)}-${norm(S.cfg.caixa || 'caixa').replace(/\s+/g, '-')}.json`, JSON.stringify(pac), 'application/json');
}
async function receberCaixa(file) {
  try {
    const pac = JSON.parse(await file.text()); if (!['caixa', 'backup', 'pacote'].includes(pac.tipo)) throw new Error('Arquivo não é do PDV Shows');
    const lotes = pac.tipo === 'caixa' ? [pac.lote] : pac.lotes; let nv = 0, nm = 0;
    if (pac.tipo === 'pacote') { // configuração completa: catálogo e tabela substituem os deste aparelho
      if (pac.produtos?.length) { pac.produtos.forEach(p => S.produtos.set(p.sku, p)); await DB.bulk('produtos', pac.produtos, true); }
      if (pac.tabela && Object.keys(pac.tabela).length) { S.tabela = pac.tabela; S.tabelaInfo = pac.tabelaInfo || { em: pac.em, arq: 'configuração' }; await DB.put('meta', { k: 'tabela', v: S.tabela, em: S.tabelaInfo.em, arq: S.tabelaInfo.arq }, true); }
      if (pac.custos && Object.keys(pac.custos).length) { S.custos = pac.custos; S.custosInfo = pac.custosInfo || { em: pac.em, arq: 'configuração' }; await DB.put('meta', { k: 'custos', v: S.custos, em: S.custosInfo.em, arq: S.custosInfo.arq }, true); }
      if (pac.cfg) { S.cfg = { ...S.cfg, ...pac.cfg, taxas: { ...S.cfg.taxas, ...(pac.cfg.taxas || {}) } }; await saveCfg(); }
    } else for (const p of pac.produtos || []) if (!S.produtos.has(p.sku)) { S.produtos.set(p.sku, p); await DB.put('produtos', p); }
    for (const l of lotes) { const meu = S.lotes.find(x => x.id === l.id);
      if (!meu) { S.lotes.push(l); await DB.put('lotes', l); }
      else { // junta shows; carga e contagem ficam com o caixa principal
        l.shows.forEach(s => { if (!meu.shows.find(x => x.id === s.id)) meu.shows.push(s); }); if (!Object.keys(meu.carga || {}).length) meu.carga = l.carga; await saveLote(meu); } }
    for (const v of pac.vendas || []) { const i = S.vendas.findIndex(x => x.id === v.id); if (i < 0) { S.vendas.push(v); nv++; await DB.put('vendas', v); } else if (v.status === 'cancelada' && S.vendas[i].status !== 'cancelada') { S.vendas[i] = v; await DB.put('vendas', v); } }
    for (const m of pac.movs || []) { const i = S.movs.findIndex(x => x.id === m.id); if (i < 0) { S.movs.push(m); nm++; await DB.put('movs', m); } else if (m.status === 'cancelada') { S.movs[i] = m; await DB.put('movs', m); } }
    render(); toast(pac.tipo === 'pacote' ? `Configuração recebida: ${pac.produtos?.length || 0} produtos, ${Object.keys(pac.tabela || {}).length} preços, ${lotes.length} lotes abertos` : `Recebido de ${pac.de || 'outro caixa'}: ${nv} vendas e ${nm} bonificações novas`);
    Sinc.ciclo();
  } catch (e) { toast(e.message || 'Arquivo inválido', null, true); }
}

// ---------- relatório PDF ----------
// Relatório em duas partes: 1) resultado comercial (sócios: Gabriel e Yuri); 2) conciliação e baixas no ERP (Yuri)
function relatorioHTML(l) {
  const r = resumo(l); const sd = saldos(l); const ret = l.retorno || {}; const fech = l.status === 'fechado'; const obs = l.obsDif || {};
  const linhas = Object.entries(sd).filter(([, x]) => x.carga || x.vendido || x.mov).map(([s, x]) => {
    const dif = ret[s] === undefined ? null : ret[s] - x.saldo;
    return { s, p: S.produtos.get(s) || { descricao: s }, ...x, ret: ret[s], dif, perda: dif < 0 ? -dif : 0, sobra: dif > 0 ? dif : 0 };
  }).sort((a, b) => (a.dif || 0) - (b.dif || 0) || (b.vendido + b.mov) - (a.vendido + a.mov) || a.s.localeCompare(b.s)); // divergências e movimentados primeiro
  const movs = movsLote(l); const inf = l.conferenciaInfinite; const F = fin(l); const M = margem(l); const a = analiseInfinite(l);
  const semSaldo = vendasLote(l).flatMap(v => v.itens.filter(i => i.semSaldo).map(i => ({ ...i, num: v.num, motivo: i.semSaldo })));
  const descs = vendasLote(l).filter(v => v.desconto);
  const soma = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const custo = x => custoDe(x.s);
  const vendidos = linhas.filter(x => x.vendido), bonif = linhas.filter(x => x.mov), perdas = linhas.filter(x => x.perda), sobras = linhas.filter(x => x.sobra);
  const dev = linhas.filter(x => x.ret);
  const pct = (v, base) => (base ? v / base * 100 : 0).toFixed(1).replace('.', ',') + '%';
  const shows = l.shows || []; const showsPorId = Object.fromEntries(shows.map(s => [s.id, s]));
  const FORMAS_REC = [['pix', 'Pix'], ['credito', 'Crédito'], ['debito', 'Débito'], ['dinheiro', 'Dinheiro']];

  // faturado (PDV) x recebido de verdade, por forma, com cada diferença justificada
  const difs = FORMAS_REC.map(([k, n]) => ({ k, n, pdv: F.r.formas[k] || 0, rec: F.real[k] })).filter(x => x.pdv || x.rec);
  const difInf = difs.filter(x => x.rec !== null).map(x => x.rec - x.pdv);
  const outrosRec = F.f.outros.reduce((s, o) => s + (o.valor || 0), 0); const outroPdv = F.r.formas.outro || 0;
  const todasDifs = [...difInf, ...(outrosRec || outroPdv ? [outrosRec - outroPdv] : [])];
  const entreFormas = (todasDifs.reduce((s, d) => s + Math.abs(d), 0) - Math.abs(todasDifs.reduce((s, d) => s + d, 0))) / 2;
  const formaJust = F.f.ajustes.filter(x => x.cat === 'forma').reduce((s, x) => s + (x.valor || 0), 0);
  const entreFormasSemJust = +(entreFormas - formaJust).toFixed(2);
  const blocoRecebimento = () => `<table class="mini"><thead><tr><th class="l">Recebimento</th><th>Faturado</th><th>Recebido</th><th>Diferença</th></tr></thead><tbody>
    ${difs.map(x => { const d = x.rec === null ? null : x.rec - x.pdv; return `<tr><td class="l">${x.n}</td><td>${brl(x.pdv)}</td><td>${x.rec === null ? '<span class="neg">não informado</span>' : brl(x.rec)}</td><td class="${d && Math.abs(d) >= .01 ? 'neg' : ''}">${d === null ? '—' : brl(d)}</td></tr>`; }).join('')}
    ${outrosRec || outroPdv ? `<tr><td class="l">Outros meios${F.f.outros.length ? ' (' + F.f.outros.map(o => esc(o.nome || '?')).join(', ') + ')' : ''}</td><td>${brl(outroPdv)}</td><td>${brl(outrosRec)}</td><td class="${Math.abs(outrosRec - outroPdv) >= .01 ? 'neg' : ''}">${brl(outrosRec - outroPdv)}</td></tr>` : ''}
    <tr class="tot"><td class="l">Total</td><td>${brl(F.r.liq)}</td><td>${brl(F.realTotal)}</td><td class="${Math.abs(F.dif) >= .01 ? 'neg' : ''}">${brl(F.dif)}</td></tr></tbody></table>
    ${F.f.ajustes.length ? `<table class="mini just"><thead><tr><th class="l">Justificativa da diferença</th><th>Valor</th><th class="l">Efeito</th></tr></thead><tbody>
    ${F.f.ajustes.map(x => { const c = CAT_AJ[x.cat] || {}; return `<tr><td class="l"><b>${esc(c.nome || x.cat)}</b>${x.sku ? ' · ' + esc(x.sku) + ' (' + x.qtd + ' pç)' : ''}${x.obs ? ' · ' + esc(x.obs) : ''}${x.quem ? ' · ' + esc(x.quem) : ''}</td><td>${c.neutro ? '' : x.dir === 'menos' ? '−' : '+'}${brl(x.valor)}</td><td class="l">${c.neutro ? 'só entre formas' : c.venda ? 'muda a venda' : 'sai da margem'}</td></tr>`; }).join('')}</tbody></table>` : ''}
    <div class="checks"><span class="${Math.abs(F.pendente) < .01 ? 'ok' : 'neg'}">Diferença total sem justificativa: <b>${brl(F.pendente)}</b></span>
    ${entreFormasSemJust >= .01 ? `<span class="neg">Diferença entre formas compensada (${brl(entreFormasSemJust)}) sem justificativa "forma de pagamento trocada"</span>` : ''}
    ${F.faltaInformar.length ? `<span class="neg">Falta informar o recebido: ${F.faltaInformar.join(', ')}</span>` : ''}</div>`;

  // DRE de cada show (margem de contribuição), com o faturamento do show em destaque
  const linhaDRE = (c, k, nome, sinal = '−') => `<tr><td class="l">${sinal ? '(' + sinal + ') ' : ''}${nome}</td><td>${brl(c[k])}</td><td class="pc">${pct(c[k], c.rec)}</td></tr>`;
  const dre = c => `<table class="mini dre"><tbody>
    <tr class="rec"><td class="l">Receita líquida</td><td>${brl(c.rec)}</td><td class="pc">100%</td></tr>
    ${linhaDRE(c, 'das', `DAS ${String(S.cfg.das || 0).replace('.', ',')}%`)}${linhaDRE(c, 'taxa', 'Taxas de cartão')}${linhaDRE(c, 'cmv', 'CMV (custo das peças)')}
    ${linhaDRE(c, 'bonif', 'Bonificações a custo')}${linhaDRE(c, 'perda', 'Perdas da contagem')}${linhaDRE(c, 'desp', 'Despesas do show')}${linhaDRE(c, 'quebra', 'Quebra de caixa e ajustes')}
    <tr class="mc"><td class="l">= Resultado do show (margem de contribuição)</td><td>${brl(c.mc)}</td><td class="pc">${pct(c.mc, c.rec)}</td></tr></tbody></table>`;
  const cardShow = (c, comRecebimento) => { const s = showsPorId[c.id]; const x = s ? resumo(l, s.id) : r; const bon = s ? movs.filter(m => m.showId === s.id).reduce((q, m) => q + m.qtd, 0) : soma(bonif, y => y.mov);
    const ajusteVenda = c.rec - x.liq;
    return `<div class="sc${c.mc < 0 ? ' prej' : ''}"><div class="ch"><div><div class="c">${s ? esc(s.cidade) + '/' + s.uf : 'Total do lote'}</div><div class="d">${s ? fmtD(s.data) + (s.evento ? ' · ' + esc(s.evento) : '') : shows.length + ' shows'}</div></div>
      <div class="res"><span>Resultado</span><b class="${c.mc < 0 ? 'neg' : ''}">${brl(c.mc)}</b><small>${pct(c.mc, c.rec)} da receita</small></div></div>
      <div class="cols"><div class="fat"><span class="lbl">Faturamento</span><div class="v">${brl(c.rec)}</div>
        <div class="m"><b>${x.n}</b> vendas · <b>${x.pecas}</b> peças · ticket <b>${brl(x.ticket)}</b>${bon ? ` · <b>${bon}</b> bonif.` : ''}${x.desc ? ` · descontos <b>${brl(x.desc)}</b>` : ''}</div>
        ${Math.abs(ajusteVenda) >= .01 ? `<div class="m">PDV ${brl(x.liq)} ${ajusteVenda > 0 ? '+' : '−'} ${brl(Math.abs(ajusteVenda))} da conferência financeira</div>` : ''}
        ${comRecebimento ? blocoRecebimento() : `<table class="mini"><tbody>${FORMAS.filter(f => x.formas[f.id]).map(f => `<tr><td class="l">${f.nome}</td><td>${brl(x.formas[f.id])}</td></tr>`).join('')}</tbody></table>`}</div>
      <div>${dre(c)}</div></div></div>`; };
  const cards = shows.length > 1 ? [...M.cols.map(c => cardShow(c, false)), cardShow({ ...M.tot, id: null }, true)] : M.cols.map(c => cardShow(c, true));

  return `<div class="hdr"><div><img src="marca/logo-positivo.svg" alt="Indião Store"><div class="tit">Relatório de vendas em show · ${fech ? 'FINAL' : 'PARCIAL'}</div></div>
  <div style="text-align:right"><b>Pedido Tiny: ${esc(l.pedido || '—')}</b><br>Emitido em ${new Date().toLocaleString('pt-BR')}${fech ? '' : '<br><b class="neg">Lote ainda não fechado</b>'}${F.f.concluido ? '' : '<br><b class="neg">Conferência financeira não concluída</b>'}</div></div>
  <div class="sec">1 · Resultado comercial</div>
  <div class="k"><div><b>${brl(M.tot.rec)}</b>faturamento${M.conf ? ' conferido' : ' (PDV)'}</div><div><b>${F.f.concluido || !F.faltaInformar.length ? brl(F.realTotal) : '—'}</b>recebido de fato</div>
    <div class="hl"><b class="${M.tot.mc < 0 ? 'neg' : ''}">${brl(M.tot.mc)}</b>resultado do lote (${pct(M.tot.mc, M.tot.rec)})</div><div><b>${r.pecas} pç · ${brl(r.ticket)}</b>peças vendidas · ticket médio</div></div>
  <table class="lote"><tr><td class="l">Shows</td><td class="l">${shows.map(s => `${esc(s.cidade)}/${s.uf} (${fmtD(s.data)}${s.evento ? ', ' + esc(s.evento) : ''})`).join('; ')}</td></tr>
  <tr><td class="l">Responsável / equipe</td><td class="l">${esc(l.resp)}${l.equipe ? ' · ' + esc(l.equipe) : ''}</td></tr>
  <tr><td class="l">Carga</td><td class="l">${Object.values(l.carga || {}).reduce((s, v) => s + v, 0)} peças · vendidas ${r.pecas} · bonificadas ${soma(bonif, x => x.mov)} · perdas ${soma(perdas, x => x.perda)} · sobras ${soma(sobras, x => x.sobra)} · retorno ${soma(dev, x => x.ret)}</td></tr></table>

  <h2>Faturamento e resultado por show</h2>${cards.join('')}
  <p class="foot">Receita conferida (PDV + ajustes da conferência financeira que mudam a venda). DAS sobre a receita · taxas ${M.taxaReal ? 'reais do extrato InfinitePay' : 'estimadas'} · CMV, bonificações e perdas pelo custo oficial${M.semCusto.length ? ` (<span class="neg">${M.semCusto.length} SKUs sem custo: CMV subestimado</span>)` : ''} · despesas do lote rateadas pela receita · quebra de caixa não muda a venda nem o DAS, mas sai do resultado.${M.conf ? '' : ' <span class="neg">Prévia: conferência financeira não concluída.</span>'}</p>
  ${(l.despesas || []).length ? `<h2>Despesas do show</h2><table><thead><tr><th class="l">Despesa</th><th class="l">Show</th><th class="l">Obs.</th><th class="l">Lançou</th><th>Valor</th></tr></thead><tbody>${l.despesas.map(d => `<tr><td class="l">${esc(d.cat)}</td><td class="l">${d.showId ? esc(showsPorId[d.showId]?.cidade || '') : 'Todo o lote'}</td><td class="l">${esc(d.obs || '')}</td><td class="l">${esc(d.quem || '')}</td><td>${d.tipo === 'pct' ? String(d.valor).replace('.', ',') + '% da venda' : brl(d.valor)}</td></tr>`).join('')}
    <tr><th class="l" colspan="4">Total</th><th>${brl(M.tot.desp)}</th></tr></tbody></table>` : ''}
  ${movs.length ? `<h2>Bonificações (CFOP ${esc(S.cfg.cfopBonif)})</h2><table><thead><tr><th class="l">Data</th><th class="l">Tipo</th><th class="l">SKU</th><th>Qtd</th><th>Custo</th><th class="l">Autorizou</th><th class="l">Lançou</th><th class="l">Obs.</th></tr></thead><tbody>
  ${movs.map(m => `<tr><td class="l">${fmtDT(m.ts)}</td><td class="l">${esc(MOV[m.tipo] || m.tipo)}</td><td class="l">${esc(m.sku)}</td><td>${m.qtd}</td><td>${brl(custoDe(m.sku) * m.qtd)}</td><td class="l">${esc(m.autorizou)}</td><td class="l">${esc(m.quem)}</td><td class="l">${esc(m.obs)}</td></tr>`).join('')}</tbody></table>` : ''}
  ${descs.length || semSaldo.length ? `<h2>Descontos e exceções</h2><table><tbody>${descs.map(v => `<tr><td class="l">Venda #${v.num}</td><td class="l">Desconto ${brl(v.desconto)} · ${esc(v.descMotivo)} · ${esc(v.vendedor)}</td></tr>`).join('')}${semSaldo.map(i => `<tr><td class="l">Venda #${i.num}</td><td class="l">${esc(i.sku)} vendido sem saldo na carga · ${esc(i.motivo)}</td></tr>`).join('')}
    ${descs.length ? `<tr><th class="l">Total de descontos</th><th class="l">${brl(soma(descs, v => v.desconto))} (${pct(soma(descs, v => v.desconto), r.bruto)} do bruto)</th></tr>` : ''}</tbody></table>` : ''}

  <div class="sec quebra">2 · Conciliação e baixas no ERP</div>
  <h2>Baixas no Tiny (documentos separados)</h2>
  <table><thead><tr><th class="l">Documento</th><th class="l">CFOP</th><th>Peças</th><th>Valor</th><th class="l">Base do valor</th></tr></thead><tbody>
  ${(() => { const aj = Object.values(baixasAjustadas(l)); return F.f.concluido
    ? `<tr><td class="l">Pedido de venda (só o vendido)</td><td class="l">do pedido</td><td>${aj.reduce((s, it) => s + it.q, 0)}</td><td>${brl(aj.reduce((s, it) => s + (it.q ? it.valor : 0), 0))}</td><td class="l">conferência financeira</td></tr>`
    : `<tr><td class="l">Pedido de venda (só o vendido)</td><td class="l">do pedido</td><td>${soma(vendidos, x => x.vendido)}</td><td>${brl(soma(vendidos, x => x.valor))}</td><td class="l neg">PDV, sem conferência financeira</td></tr>`; })()}
  <tr><td class="l">Nota de bonificação</td><td class="l">${esc(S.cfg.cfopBonif)}</td><td>${soma(bonif, x => x.mov)}</td><td>${brl(soma(bonif, x => x.mov * custo(x)))}</td><td class="l">custo oficial</td></tr>
  <tr><td class="l">Nota de perda (contagem)</td><td class="l">${esc(S.cfg.cfopPerda)}</td><td>${Object.values(baixasAjustadas(l)).reduce((s, it) => s + it.perda, 0)}</td><td>${brl(soma(perdas, x => x.perda * custo(x)))}</td><td class="l">custo oficial</td></tr>
  <tr><td class="l">Retorno ao estoque</td><td class="l">—</td><td>${soma(dev, x => x.ret)}</td><td>—</td><td class="l">contagem física</td></tr>
  </tbody></table>
  <p class="foot">Bonificação e perda saem fora do pedido de venda, para não diluir o preço médio. Sobra (contado acima do esperado) não gera nota: confira a carga e as vendas do SKU. O pedido da carga (${esc(l.pedido || '—')}) só é excluído depois de lançar no estoque a venda, a bonificação e a perda.</p>

  <h2>Contas a receber (baixa por forma e bandeira)</h2>
  ${a ? (() => { const ks = Object.entries(a.porFormaBand).sort((x, y) => y[1].valor - x[1].valor);
    const din = F.real.dinheiro || 0; const tot = { n: a.ap.length, valor: a.bruto + din + outrosRec, taxa: a.taxa, liq: a.liq + din + outrosRec };
    return `<table><thead><tr><th class="l">Forma · bandeira</th><th>Qtd</th><th>Bruto</th><th>Taxa</th><th>Taxa efetiva</th><th>Líquido</th></tr></thead><tbody>
    ${ks.map(([k, x]) => `<tr><td class="l">${esc(k)}</td><td>${x.n}</td><td>${brl(x.valor)}</td><td>${brl(x.taxa)}</td><td>${pctTaxa(x)}</td><td>${brl(x.liq)}</td></tr>`).join('')}
    ${din ? `<tr><td class="l">Dinheiro (contado no caixa)</td><td>—</td><td>${brl(din)}</td><td>${brl(0)}</td><td>0,00%</td><td>${brl(din)}</td></tr>` : ''}
    ${F.f.outros.filter(o => o.valor).map(o => `<tr><td class="l">${esc(o.nome || 'Outro meio')}</td><td>—</td><td>${brl(o.valor)}</td><td>—</td><td>—</td><td>${brl(o.valor)}</td></tr>`).join('')}
    <tr><th class="l">Total</th><th>${tot.n}</th><th>${brl(tot.valor)}</th><th>${brl(tot.taxa)}</th><th>${pctTaxa(tot)}</th><th>${brl(tot.liq)}</th></tr></tbody></table>
    <p class="foot">Baixa no Tiny: valor bruto recebido, taxa como despesa financeira, líquido igual ao crédito em conta. Extrato InfinitePay: ${inf.n} transações aprovadas entre ${fmtDT(inf.de)} e ${fmtDT(inf.ate)}${a.negadas.length ? ` · ${a.negadas.length} negadas ou canceladas fora dos totais` : ''}.</p>`; })()
    : `<p class="neg">Sem extrato da InfinitePay: importe na aba Relatório para baixar o contas a receber pelas taxas reais. Taxas estimadas pelo PDV: ${brl(taxasPdv(l))}.</p>`}

  <h2>Conferência financeira ${F.f.concluido ? `<span class="small">concluída em ${fmtDT(F.f.concluidoEm)} por ${esc(F.f.concluidoPor)}</span>` : '<span class="neg">(não concluída)</span>'}</h2>
  ${blocoRecebimento()}
  <p>Venda no pedido do Tiny: <b>${brl(F.vendaAjustada)}</b> · ajustes que saem da margem: ${brl(-(F.justificado - F.ajVenda))}</p>
  ${a ? `<h2>Conciliação venda a venda (PDV × InfinitePay)</h2>
    <p><b>${a.conciliadas} de ${a.pags}</b> pagamentos do PDV com transação de mesma forma e valor em até 30 minutos.${a.conciliadas < a.pags ? ' <span class="neg">Venda lançada no app muito depois de passar na maquininha não concilia: confira as listas abaixo.</span>' : ''}</p>
    ${a.semPdv.length ? `<table><thead><tr><th class="l" colspan="4">Transações sem venda no PDV (${a.semPdv.length} · ${brl(a.semPdv.reduce((s, t) => s + t.valor, 0))})</th></tr></thead><tbody>${a.semPdv.map(t => `<tr><td class="l">${fmtDT(t.t)}</td><td class="l">${FORMA[t.forma]}${t.forma !== 'pix' ? ' · ' + esc(titulo(t.band)) : ''}${t.parc > 1 ? ' ' + t.parc + 'x' : ''}</td><td class="l">${esc(t.term)}</td><td>${brl(t.valor)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${a.semTx.length ? `<p><b class="neg">Pagamentos do PDV sem transação (${a.semTx.length}):</b> ${a.semTx.map(p => `#${p.num} ${FORMA[p.forma]} ${brl(p.valor)}`).join(' · ')}</p>` : ''}
    <table><thead><tr><th class="l">Origem (máquina / tap / Pix)</th><th>Qtd</th><th>Bruto</th><th>Taxa</th><th>Líquido</th></tr></thead><tbody>${Object.entries(a.porTerm).map(([k, x]) => `<tr><td class="l">${esc(k)}</td><td>${x.n}</td><td>${brl(x.valor)}</td><td>${brl(x.taxa)}</td><td>${brl(x.liq)}</td></tr>`).join('')}</tbody></table>` : ''}

  ${perdas.length || sobras.length ? `<h2>Divergências da contagem</h2><table><thead><tr><th class="l">SKU</th><th class="l">Descrição</th><th>Esperado</th><th>Contado</th><th>Diferença</th><th class="l">Observação</th></tr></thead><tbody>
  ${[...perdas, ...sobras].map(x => `<tr><td class="l">${esc(x.s)}</td><td class="l">${esc(x.p.descricao)}</td><td>${x.saldo}</td><td>${x.ret ?? 0}</td><td class="${x.dif < 0 ? 'neg' : ''}">${x.dif > 0 ? '+' : ''}${x.dif}</td><td class="l">${esc(obs[x.s] || '—')}</td></tr>`).join('')}</tbody></table>` : ''}

  ${(() => { const mov = linhas.filter(x => x.vendido || x.mov || x.perda || x.sobra); const so = linhas.filter(x => !(x.vendido || x.mov || x.perda || x.sobra));
    return `<h2>Itens movimentados</h2><table class="itens"><thead><tr><th class="l">SKU</th><th class="l">Descrição</th><th>Carga</th><th>Venda</th><th>Preço médio</th><th>Total venda</th><th>Bonif.</th><th>Perda</th><th>Sobra</th><th>Retorno</th></tr></thead><tbody>
    ${mov.map(x => `<tr><td class="l">${esc(x.s)}</td><td class="l">${esc(x.p.descricao)}</td><td>${x.carga}</td><td>${x.vendido}</td><td>${x.vendido ? brl(x.valor / x.vendido) : '—'}</td><td>${brl(x.valor)}</td><td>${x.mov}</td><td class="${x.perda ? 'neg' : ''}">${x.perda}</td><td>${x.sobra}</td><td>${x.ret ?? '—'}</td></tr>`).join('')}
    <tr><th class="l" colspan="2">Total do lote (inclui o retorno integral abaixo)</th><th>${soma(linhas, x => x.carga)}</th><th>${soma(linhas, x => x.vendido)}</th><th></th><th>${brl(soma(linhas, x => x.valor))}</th><th>${soma(linhas, x => x.mov)}</th><th>${soma(linhas, x => x.perda)}</th><th>${soma(linhas, x => x.sobra)}</th><th>${soma(linhas, x => x.ret || 0)}</th></tr></tbody></table>
    ${so.length ? `<p class="small"><b>Retorno integral (sem venda, bonificação ou divergência): ${so.length} SKUs, ${soma(so, x => x.ret ?? x.carga)} peças.</b> ${so.map(x => `${esc(x.s)} (${x.ret ?? x.carga})`).join(' · ')}</p>` : ''}`; })()}
  <div class="sign"><div>Responsável pela venda</div><div>Conferente da contagem</div></div>
  <p class="foot">Gerado pelo PDV Shows Indião · caixa ${esc(S.cfg.caixa)} · ${vendasLote(l, true).length} registros de venda, ${S.movs.filter(m => m.loteId === l.id).length} de bonificação.</p>`;
}

// ---------- fotos offline, persistência, tela ligada ----------
async function baixarFotos() {
  const urls = [...new Set([...S.produtos.values()].map(p => fotoDe(p)).filter(u => /^https?:/.test(u)))]; const st = $('#fotosStatus');
  if (!navigator.onLine) { toast('Precisa de internet para guardar as fotos', null, true); return; }
  const c = await caches.open('pdv-fotos'); let ok = 0;
  for (const u of urls) { try { if (!(await c.match(u))) { const r = await fetch(u, { mode: 'no-cors' }); await c.put(u, r); } ok++; } catch (e) { } if (st) st.textContent = `${ok} de ${urls.length} fotos guardadas`; }
  toast(`${ok} fotos prontas para uso offline`);
}
async function checarPersist() {
  const el = $('#persist'); if (!el) return;
  let p = false; try { p = await navigator.storage.persisted(); if (!p) p = await navigator.storage.persist(); } catch (e) { }
  let est = ''; try { const e = await navigator.storage.estimate(); est = ` · usando ${(e.usage / 1e6).toFixed(1)} MB`; } catch (e) { }
  el.textContent = (p ? 'Armazenamento protegido: o navegador não apaga os dados sozinho.' : 'Armazenamento não protegido: instale o app na tela inicial e faça backup ao fim de cada lote.') + est;
}
let wakeLock;
async function wake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); } } catch (e) { } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.view === 'lote') wake(); });
addEventListener('online', () => { render(); Sinc.ciclo(); }); addEventListener('offline', render);

// ---------- início ----------
(async function boot() {
  await DB.open();
  const [ps, ls, vs, ms, meta] = await Promise.all(['produtos', 'lotes', 'vendas', 'movs', 'meta'].map(s => DB.all(s)));
  ps.forEach(p => S.produtos.set(p.sku, p)); S.lotes = ls; S.vendas = vs; S.movs = ms;
  try { S.miniaturas = await (await fetch('fotos/indice.json')).json(); } catch (e) { S.miniaturas = { skus: {} }; }
  const cu = meta.find(m => m.k === 'custos'); if (cu) { S.custos = cu.v || {}; S.custosInfo = { em: cu.em, arq: cu.arq }; }
  const tb = meta.find(m => m.k === 'tabela'); if (tb) { S.tabela = tb.v || {}; S.tabelaInfo = { em: tb.em, arq: tb.arq }; }
  const cfg = meta.find(m => m.k === 'cfg'); if (cfg) S.cfg = { ...S.cfg, ...cfg.v, taxas: { ...S.cfg.taxas, ...(cfg.v.taxas || {}) } };
  if (!S.cfg.aparelho) { S.cfg.aparelho = uid(); saveCfg(); }
  if (!S.cfg.das) { S.cfg.das = DAS_MODELAGEM.pct; S.cfg.dasRef = `${DAS_MODELAGEM.ref} · ${DAS_MODELAGEM.fonte}`; saveCfg(); }
  const sc = meta.find(m => m.k === 'sinc'); if (sc) Sinc.st = { ...Sinc.st, ...sc.v }; Sinc.cont = Math.max(0, ...Object.values(Sinc.st.pend));
  render();
  setInterval(() => { if (document.visibilityState === 'visible') Sinc.ciclo(); }, 15000); Sinc.ciclo();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }
})();
