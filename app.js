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
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').toLowerCase().trim();
const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } };
const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
const FORMAS = [
  { id: 'pix', nome: 'Pix', cls: 'pix' }, { id: 'credito', nome: 'Crédito', cls: 'cre' },
  { id: 'debito', nome: 'Débito', cls: 'deb' }, { id: 'dinheiro', nome: 'Dinheiro', cls: 'din' }];
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
      const r = indexedDB.open('pdv-shows-indiao', 1);
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
  put(store, obj) { return DB.tx(store, 'readwrite', s => { s.put(obj); }); },
  bulk(store, arr) { return DB.tx(store, 'readwrite', s => { arr.forEach(o => s.put(o)); }); },
  del(store, key) { return DB.tx(store, 'readwrite', s => { s.delete(key); }); },
};

// ---------- estado ----------
const S = {
  produtos: new Map(), lotes: [], vendas: [], movs: [], cfg: { vendedor: '', caixa: '', tema: 'dark', aparelho: '', cfopBonif: '5.910 / 6.910', cfopPerda: '5.927' },
  view: 'home', loteId: null, tab: 'vender', busca: '', cat: '', todoCatalogo: false, esgotados: false,
  cart: [], cartDesc: 0, cartDescMotivo: '', pagamentos: [], sheet: null, contagemRevelada: false, infinite: null,
};
const lote = () => S.lotes.find(l => l.id === S.loteId);
const saveCfg = () => DB.put('meta', { k: 'cfg', v: S.cfg });
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
  S.cfg.catalogoEm = now(); saveCfg();
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
    const sku = String(r[m.sku] || '').trim(); const q = num(r[m.ini]); if (!sku || q <= 0) continue;
    carga[sku] = (carga[sku] || 0) + q; linhas++;
    if (m.vunit && num(r[m.vunit]) > 0) l.precos[sku] = num(r[m.vunit]);
    if (!S.produtos.has(sku)) {
      const p = { sku, id: m.id ? String(r[m.id]) : '', descricao: m.desc ? String(r[m.desc]).trim() : sku, preco: 0, promo: 0, img: '', pai: '', var: parseVar('', sku), cat: '' };
      S.produtos.set(sku, p); lista.push(p);
    }
  }
  if (lista.length) await DB.bulk('produtos', lista);
  await aplicarCarga(l, carga, file.name);
  return { linhas, pecas: Object.values(carga).reduce((a, b) => a + b, 0), semCadastro: lista.length };
}
async function aplicarCarga(l, carga, nome) { l.carga = carga; l.cargaArquivo = nome; l.cargaEm = now(); await saveLote(l); }

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
        if (q > 0) { carga[sku] = (carga[sku] || 0) + q; achados.push({ sku, q }); }
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
// preço de venda: o do pedido do lote no Tiny > preço de show do modelo > preço do cadastro
const precoShow = p => (S.loteId && lote()?.precos?.[p.sku]) || p.precoShow || p.preco || 0;

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
  if (v === 'home') app.innerHTML = vHome();
  else if (v === 'novo') app.innerHTML = vNovo();
  else if (v === 'catalogo') app.innerHTML = vCatalogo();
  else if (v === 'config') app.innerHTML = vConfig();
  else if (v === 'lote') app.innerHTML = vLote();
  renderSheet();
}
function topo(titulo, sub, voltar, extra = '') {
  return `<header class="top">${voltar ? `<button class="iconbtn" data-a="voltar" aria-label="Voltar">‹</button>` : ''}
  ${titulo === null ? `<img class="logo" src="marca/logo-negativo.svg" alt="Indião Store"><h1><span class="sub">${esc(sub)}</span></h1>` : `<h1>${esc(titulo)}${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</h1>`}${extra}
  <span class="net ${navigator.onLine ? 'on' : 'off'}">${navigator.onLine ? '● online' : '● offline'}</span></header><div class="faixa"></div>`;
}
function vHome() {
  const lotes = [...S.lotes].sort((a, b) => (b.criado || '').localeCompare(a.criado || ''));
  const semCfg = !S.cfg.vendedor;
  return topo(null, 'PDV Shows', false, `<button class="iconbtn" data-a="ir" data-v="config" aria-label="Configurações">⚙</button>`) + `<main>
  ${semCfg ? `<div class="warn">Antes do primeiro show: em ⚙ informe seu nome e o nome deste caixa.</div>` : ''}
  <button class="btn primary block" data-a="ir" data-v="novo" style="margin-bottom:12px">+ Novo lote de show</button>
  <div class="grid2" style="margin-bottom:16px">
    <button class="btn" data-a="ir" data-v="catalogo">Catálogo (${S.produtos.size})</button>
    <button class="btn" data-a="importarCaixa">Receber caixa</button>
  </div>
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
  <label class="f">Equipe de venda<input class="i" name="equipe" placeholder="ex.: Jonathas, Luquinhas"></label>
  <div id="shows">${blocoShow(1, today())}</div>
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
  <div class="card"><h2>Notas à parte (relatório)</h2>
  <label class="f">CFOP da bonificação<input class="i" name="cfopBonif" value="${esc(S.cfg.cfopBonif)}"></label>
  <label class="f">CFOP da perda de contagem<input class="i" name="cfopPerda" value="${esc(S.cfg.cfopPerda)}"></label></div>
  <button class="btn primary block">Salvar</button></form>
  <div class="card" style="margin-top:16px"><h2>Armazenamento</h2><p class="muted small" id="persist">Verificando…</p>
  <button class="btn block" data-a="backupTudo">Baixar backup completo</button></div>
  <p class="muted small">Versão 1.0 · Os dados ficam só neste aparelho até você exportar.</p></main>`;
}
function vCatalogo() {
  const ps = [...S.produtos.values()]; const mods = agrupar(ps);
  return topo('Catálogo', `${ps.length} SKUs · ${mods.length} modelos`, true) + `<main>
  <div class="card"><h2>Atualizar do Tiny</h2>
  <p class="muted small">No Tiny: Cadastros › Produtos › Exportar (planilha). O app lê SKU, descrição, variações, preço e a URL da foto. ${S.cfg.catalogoEm ? 'Última atualização: ' + fmtDT(S.cfg.catalogoEm) : ''}</p>
  <label class="btn primary block">Importar planilha do Tiny<input type="file" accept=".xls,.xlsx,.csv" class="hide" data-in="catalogo"></label>
  <button class="btn block" style="margin-top:10px" data-a="baixarFotos">Guardar fotos para usar offline</button>
  <p class="muted small" id="fotosStatus"></p></div>
  <div class="card"><h2>Preço de show por modelo</h2><p class="muted small">Toque no preço para mudar. Vale para todas as cores e tamanhos do modelo. Vazio = preço do Tiny.</p>
  ${mods.map(m => `<div class="line"><div class="grow"><div style="font-weight:600">${esc(m.nome)}</div><div class="muted small">${m.skus.length} SKUs · Tiny ${brl(m.preco)}</div></div>
    <button class="btn" data-a="precoModelo" data-m="${esc(m.id)}">${m.precoShow ? brl(m.precoShow) : '—'}</button></div>`).join('') || '<div class="empty">Importe o catálogo.</div>'}
  </div></main>`;
}
function agrupar(ps) {
  const g = new Map();
  ps.forEach(p => { const id = modeloDe(p); if (!g.has(id)) g.set(id, { id, nome: nomeModelo(p), img: '', cat: p.cat, preco: p.preco, precoShow: p.precoShow || 0, skus: [] }); const m = g.get(id); m.skus.push(p); if (!m.img && p.img) m.img = p.img; if (!m.cat && p.cat) m.cat = p.cat; });
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
const rotulo = p => [p.var?.Cor, p.var?.Tamanho].filter(Boolean).join(' · ') || p.sku;
function vLote() {
  const l = lote(); if (!l) { S.view = 'home'; return vHome(); }
  const sh = showAtual(l); const fechado = l.status !== 'aberto';
  const tabs = [['vender', 'Vender'], ['vendas', 'Vendas'], ['movs', 'Bonificações'], ['contagem', 'Contagem'], ['relatorio', 'Relatório']];
  let body = '';
  if (S.tab === 'vender') body = fechado ? `<div class="warn">${l.status === 'fechado' ? 'Lote fechado. Veja o Relatório.' : 'Vendas travadas para a contagem. Termine a contagem na aba Contagem.'}</div>` : tVender(l);
  if (S.tab === 'vendas') body = tVendas(l);
  if (S.tab === 'movs') body = tMovs(l);
  if (S.tab === 'contagem') body = tContagem(l);
  if (S.tab === 'relatorio') body = tRelatorio(l);
  return topo(l.pedido ? 'Pedido ' + l.pedido : 'Lote', sh ? `${sh.cidade}/${sh.uf} · ${fmtD(sh.data)}` : 'sem show', true,
    `<button class="iconbtn" data-a="sheetShow" aria-label="Trocar show">📍</button>`) +
    `<nav class="tabs">${tabs.map(([k, n]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-a="tab" data-t="${k}">${n}</button>`).join('')}</nav>
    <main>${body}</main>${S.tab === 'vender' && !fechado ? cartBar() : ''}`;
}
function tVender(l) {
  if (!Object.keys(l.carga || {}).length) return `<div class="card"><h2>Falta a carga deste lote</h2>
    <p class="muted small">A carga é o que foi retirado do estoque no pedido "Shows e Eventos". A venda só mostra esses itens. Sem carga, o app não controla o saldo.</p>
    <label class="btn primary block">Importar pedido do Tiny (CSV)<input type="file" accept=".csv,.xls,.xlsx" class="hide" data-in="carga"></label>
    <p class="muted small">No Tiny: Vendas › Pedidos de venda › marque o pedido "Shows e Eventos" › Exportar. O app lê SKU, quantidade e o preço de show do pedido.</p>
    <label class="btn block">Importar PDF do pedido ou da nota<input type="file" accept=".pdf,application/pdf" class="hide" data-in="carga"></label>
    <button class="btn block" style="margin-top:10px" data-a="contarCarga">Contar a carga no app</button></div>`;
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
  return `<div class="search"><input class="i" style="width:100%" type="search" placeholder="Buscar modelo ou SKU" value="${esc(S.busca)}" data-in="busca" enterkeyhint="search"></div>
  <div class="chips"><button class="chip ${!S.cat ? 'on' : ''}" data-a="cat" data-c="">Todos</button>${cats.map(c => `<button class="chip ${S.cat === c ? 'on' : ''}" data-a="cat" data-c="${esc(c)}">${esc(c)}</button>`).join('')}
  ${nEsg && !S.todoCatalogo ? `<button class="chip ${S.esgotados ? 'on' : ''}" data-a="esgotados">Esgotados (${nEsg})</button>` : ''}
  <button class="chip ${S.todoCatalogo ? 'on' : ''}" data-a="todoCat">Fora da carga</button></div>
  <div class="tiles">${lista.map(m => { const saldo = m.skus.reduce((a, p) => a + (sd[p.sku]?.saldo || 0), 0) - m.skus.reduce((a, p) => a + (noCart[p.sku] || 0), 0);
    const qc = m.skus.reduce((a, p) => a + (noCart[p.sku] || 0), 0); const pr = precoShow(m.skus[0]);
    return `<button class="tile" data-a="abrirModelo" data-m="${esc(m.id)}" aria-label="${esc(m.nome)}, saldo ${saldo}">
      <div class="ph">${m.img ? `<img src="${esc(m.img)}" alt="" loading="lazy" onerror="this.remove()">` : esc(m.nome.slice(0, 2).toUpperCase())}</div>
      ${qc ? `<span class="q">${qc}</span>` : ''}<span class="s ${saldo <= 0 ? 'zero' : ''}">${saldo}</span>
      <div class="t"><div class="muted small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(curto(m.nome)[0])}</div><div class="n">${esc(curto(m.nome)[1])}</div><div class="p">${pr ? brl(pr) : '<span class="muted">sem preço</span>'}</div></div></button>`; }).join('') || '<div class="empty">Nada encontrado.</div>'}</div>`;
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
    <div class="small">${v.pagamentos.map(p => FORMA[p.forma] + ' ' + brl(p.valor) + (p.parcelas > 1 ? ` ${p.parcelas}x` : '')).join(' + ')}${v.desconto ? ` · desconto ${brl(v.desconto)} (${esc(v.descMotivo || 'sem motivo')})` : ''}${v.troco ? ` · troco ${brl(v.troco)}` : ''}</div>
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
  <div class="row"><span class="grow">${contados} de ${skus.length} SKUs contados</span>${l.status === 'aberto' ? `<button class="btn" style="min-height:44px" data-a="iniciarContagem">Travar vendas</button>` : '<span class="pill contagem">vendas travadas</span>'}</div></div>
  ${mods.map(m => `<div class="card"><h2>${esc(m.nome)}</h2>${m.skus.sort((a, b) => (a.var?.Cor || '').localeCompare(b.var?.Cor || '') || tamIdx(a.var?.Tamanho) - tamIdx(b.var?.Tamanho)).map(p => `<div class="line">
    <div class="grow"><div style="font-weight:700">${esc([p.var?.Cor, p.var?.Tamanho].filter(Boolean).join(' · ') || p.sku)}</div><div class="muted small">${esc(p.sku)}</div></div>
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
  <div class="card"><table class="t"><thead><tr><th>SKU</th><th>Carga</th><th>Vend.</th><th>Bonif.</th><th>Esper.</th><th>Cont.</th><th>Dif.</th></tr></thead><tbody>
  ${linhas.sort((a, b) => a.dif - b.dif || a.s.localeCompare(b.s)).map(x => `<tr><td>${esc(x.s)}</td><td>${x.carga}</td><td>${x.vendido}</td><td>${x.mov}</td><td>${x.saldo}</td><td>${x.ret ?? '–'}</td><td class="${x.dif < 0 ? 'neg' : x.dif > 0 ? 'pos' : 'zerot'}">${x.dif > 0 ? '+' : ''}${x.dif}</td></tr>`).join('')}
  </tbody></table></div>
  ${l.status !== 'fechado' ? `<div class="grid2"><button class="btn" data-a="recontar">Voltar e recontar</button><button class="btn ok" data-a="fecharLote">Fechar lote</button></div>` : `<div class="muted small">Lote fechado em ${fmtDT(l.fechadoEm)} por ${esc(l.fechadoPor)}.</div>`}`;
}
function tRelatorio(l) {
  const r = resumo(l); const sh = l.shows || [];
  const inf = S.infinite && S.infinite.loteId === l.id ? S.infinite : null;
  return `<div class="card"><h2>Resumo do lote</h2><div class="kpis">
    <div class="kpi"><b>${brl(r.liq)}</b><span>vendas líquidas</span></div><div class="kpi"><b>${r.n}</b><span>vendas (${r.canc} canceladas)</span></div>
    <div class="kpi"><b>${r.pecas}</b><span>peças vendidas</span></div><div class="kpi"><b>${brl(r.ticket)}</b><span>ticket médio</span></div></div>
    ${r.desc ? `<p class="small muted">Descontos: ${brl(r.desc)} sobre ${brl(r.bruto)} brutos.</p>` : ''}</div>
  <div class="card"><h2>Por forma de pagamento</h2>${FORMAS.map(f => `<div class="line"><span class="grow">${f.nome}</span><b>${brl(r.formas[f.id] || 0)}</b>${inf && f.id !== 'dinheiro' ? `<span class="small ${Math.abs((inf.formas[f.id] || 0) - (r.formas[f.id] || 0)) > 0.5 ? 'neg' : 'zerot'}" style="min-width:110px;text-align:right">InfinitePay ${brl(inf.formas[f.id] || 0)}</span>` : ''}</div>`).join('')}
    <label class="btn block" style="margin-top:10px">${inf ? 'Trocar' : 'Conferir com'} extrato da InfinitePay<input type="file" accept=".xls,.xlsx,.csv" class="hide" data-in="infinite"></label>
    ${inf ? `<p class="small muted">${inf.n} transações aprovadas entre ${fmtDT(inf.de)} e ${fmtDT(inf.ate)}.</p>` : '<p class="small muted">Exporte as transações do período no app da InfinitePay e importe aqui para conferir Pix, crédito e débito.</p>'}</div>
  <div class="card"><h2>Por show</h2>${sh.map(s => { const x = resumo(l, s.id); return `<div class="line"><div class="grow"><b>${esc(s.cidade)}/${s.uf}</b><div class="muted small">${fmtD(s.data)}${s.evento ? ' · ' + esc(s.evento) : ''}</div></div><div style="text-align:right"><b>${brl(x.liq)}</b><div class="muted small">${x.n} vendas · ${x.pecas} pç</div></div></div>`; }).join('')}</div>
  ${l.status !== 'fechado' ? '<div class="warn">O relatório final sai depois da contagem e do fechamento. Antes disso, é parcial.</div>' : ''}
  <button class="btn primary block" data-a="pdf">Gerar PDF ${l.status === 'fechado' ? 'final' : 'parcial'}</button>
  <div class="card" style="margin-top:12px"><h2>Arquivos para importar no Tiny</h2>
  <p class="muted small">No layout de importação de pedidos. Bonificação e perda vão em pedidos separados, valorizados a custo, para não mexer no preço médio da venda.</p>
  <button class="btn block" data-a="tinyCsv" data-t="venda">Pedido de venda (só o vendido)</button>
  <div class="grid2" style="margin-top:10px"><button class="btn" data-a="tinyCsv" data-t="bonif">Bonificação<br><small>CFOP ${esc(S.cfg.cfopBonif)}</small></button><button class="btn" data-a="tinyCsv" data-t="perda">Perda<br><small>CFOP ${esc(S.cfg.cfopPerda)}</small></button></div></div>
  <div class="grid2" style="margin-top:10px"><button class="btn" data-a="csvTiny">Planilha de conferência</button><button class="btn" data-a="exportarCaixa">Enviar caixa</button></div>
  <p class="muted small">"Enviar caixa" gera um arquivo com as vendas deste aparelho. No caixa principal, use "Receber caixa" na tela inicial para juntar.</p>`;
}

// ---------- bottom sheets ----------
function renderSheet() {
  let el = $('#sheet'); if (!S.sheet) { el && el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'sheet'; el.className = 'scrim'; document.body.appendChild(el); }
  const k = S.sheet.k; let h = '';
  if (k === 'modelo') h = shModelo(); if (k === 'cart') h = shCart(); if (k === 'pagar') h = shPagar(); if (k === 'show') h = shShow();
  if (k === 'mov') h = shMov(); if (k === 'texto') h = shTexto(); if (k === 'cargaPrev') h = shCargaPrev();
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
  ${S.pagamentos.length ? `<div class="card">${S.pagamentos.map((p, i) => `<div class="line"><span class="grow">${FORMA[p.forma]}${p.parcelas > 1 ? ' ' + p.parcelas + 'x' : ''}${p.troco ? ` <span class="muted small">(recebeu ${brl(p.valor + p.troco)}, troco ${brl(p.troco)})</span>` : ''}</span><b>${brl(p.valor)}</b><button class="iconbtn" data-a="rmPag" data-i="${i}">✕</button></div>`).join('')}</div>` : ''}
  ${falta > 0 ? `<div class="pays">${FORMAS.map(f => `<button class="pay ${f.cls}" data-a="forma" data-f="${f.id}">${f.nome}<small>${brl(st.parcial ?? falta)}</small></button>`).join('')}</div>
    <button class="btn block" style="min-height:48px" data-a="dividir">${st.parcial != null ? 'Valor parcial: ' + brl(st.parcial) + ' (trocar)' : 'Dividir em duas formas'}</button>`
    : `<button class="btn ok block" style="min-height:72px;font-size:21px" data-a="finalizar">Confirmar venda${troco ? ' · troco ' + brl(troco) : ''}</button>`}
  <p class="muted small">Confirme só depois que a maquininha aprovar.</p>`;
}
function shShow() {
  const l = lote(); const at = showAtual(l);
  return `<div class="row"><h3 class="grow">Show atual</h3><button class="iconbtn" data-a="fechar">✕</button></div>
  <p class="muted small">As vendas entram no show marcado. Troque ao chegar na próxima cidade; a carga continua a mesma do lote.</p>
  ${(l.shows || []).map(s => `<button class="card" style="width:100%;text-align:left;${at && at.id === s.id ? 'border-color:var(--orange)' : ''}" data-a="usarShow" data-id="${s.id}"><b>${esc(s.cidade)}/${s.uf}</b> · ${fmtD(s.data)}<div class="muted small">${esc(s.evento || '')}</div></button>`).join('')}
  ${l.status === 'aberto' ? `<form data-f="novoShow" class="card"><h2>Adicionar show</h2>
    <label class="f">Cidade<input class="i" name="cidade" required></label>
    <div class="grid2"><label class="f">UF<select class="i" name="uf" required><option value="">--</option>${UFS.map(u => `<option ${at && at.uf === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label><label class="f">Data<input class="i" type="date" name="data" value="${today()}" required></label></div>
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
function shTexto() {
  const st = S.sheet;
  return `<h3>${esc(st.titulo)}</h3>${st.texto ? `<p class="muted">${esc(st.texto)}</p>` : ''}<form data-f="texto">
  ${st.semInput ? '<input type="hidden" name="v" value="ok">' : `<input class="i" style="width:100%;margin:10px 0" name="v" value="${esc(st.valor || '')}" ${st.tipo === 'num' ? 'inputmode="decimal"' : ''} placeholder="${esc(st.ph || '')}" ${st.obrig ? 'required' : ''} autofocus>`}
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
    const sku = e.dataset.s; const p = S.produtos.get(sku); const l = lote(); const sd = saldos(l);
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
    S.pagamentos.push({ forma: f, valor }); S.sheet = { k: 'pagar' }; vibrate(15); renderSheet();
  },
  parcelas: e => { S.pagamentos.push({ forma: 'credito', valor: S.sheet.valor, parcelas: +e.dataset.n }); S.sheet = { k: 'pagar' }; vibrate(15); renderSheet(); },
  recebido: e => { $('#recebido').value = String(e.dataset.v).replace('.', ','); $('#recebido').dispatchEvent(new Event('input')); },
  confDinheiro: () => { const v = S.sheet.valor; const rec = num($('#recebido').value) || v; if (rec < v - 0.001) { toast('Valor recebido menor que o devido', null, true); return; } S.pagamentos.push({ forma: 'dinheiro', valor: v, troco: +(rec - v).toFixed(2) }); S.sheet = { k: 'pagar' }; vibrate(15); renderSheet(); },
  volPag: () => { S.sheet = { k: 'pagar' }; renderSheet(); },
  rmPag: e => { S.pagamentos.splice(+e.dataset.i, 1); renderSheet(); },
  dividir: async () => { const v = await perguntar({ titulo: 'Quanto vai na 1ª forma?', tipo: 'num', ok: 'OK' }); S.sheet = { k: 'pagar', parcial: v ? num(v) : null }; renderSheet(); },
  finalizar: async () => {
    const l = lote(); const sh = showAtual(l); l.seq = (l.seq || 0) + 1;
    const v = { id: uid(), num: l.seq, loteId: l.id, showId: sh?.id, ts: now(), itens: S.cart.map(c => ({ sku: c.sku, qtd: c.qtd, preco: c.preco, ...(c.semSaldo ? { semSaldo: c.semSaldo } : {}) })),
      desconto: S.cartDesc, descMotivo: S.cartDesc ? S.cartDescMotivo : '', pagamentos: S.pagamentos.map(p => ({ forma: p.forma, valor: p.valor, ...(p.parcelas ? { parcelas: p.parcelas } : {}) })),
      troco: S.pagamentos.reduce((a, p) => a + (p.troco || 0), 0), vendedor: S.cfg.vendedor, caixa: S.cfg.caixa, aparelho: S.cfg.aparelho, status: 'ok' };
    S.vendas.push(v); await DB.put('vendas', v); await saveLote(l);
    const bk = { cart: S.cart, d: S.cartDesc };
    S.cart = []; S.cartDesc = 0; S.pagamentos = []; S.sheet = null; vibrate([20, 40, 20]); render();
    toast(`Venda #${v.num} registrada · ${brl(totalVenda(v).liq)}`, async () => { v.status = 'cancelada'; v.motivoCanc = 'desfeita logo após o registro'; v.canceladaEm = now(); await DB.put('vendas', v); S.cart = bk.cart; S.cartDesc = bk.d; render(); });
  },
  cancelarVenda: async e => { const v = S.vendas.find(x => x.id === e.dataset.id); const m = await perguntar({ titulo: `Cancelar venda #${v.num}?`, texto: 'A venda fica no histórico como cancelada e as peças voltam ao saldo. Estorne na maquininha se foi cartão ou Pix.', ph: 'motivo (obrigatório)', obrig: true, ok: 'Cancelar venda', perigo: true, chips: ['Lançada errada', 'Cliente desistiu', 'Pagamento recusado'] }); S.sheet = null; if (!m) return render(); v.status = 'cancelada'; v.motivoCanc = m; v.canceladaEm = now(); v.canceladaPor = S.cfg.vendedor; await DB.put('vendas', v); render(); toast('Venda cancelada'); },
  sheetShow: () => { S.sheet = { k: 'show' }; renderSheet(); },
  usarShow: async e => { const l = lote(); l.showAtual = e.dataset.id; await saveLote(l); S.sheet = null; render(); toast('Show atual trocado'); },
  novoMov: e => { S.sheet = { k: 'mov', tipo: e.dataset.t }; renderSheet(); },
  movModelo: e => { S.sheet = { k: 'modelo', m: e.dataset.m, modo: 'mov', tipo: S.sheet.tipo }; renderSheet(); },
  pickMov: e => { S.sheet = { k: 'mov', tipo: S.sheet.tipo, sku: e.dataset.s }; renderSheet(); },
  movQtd: e => { const i = $('#sheet input[name=qtd]'); i.value = Math.max(1, num(i.value) + +e.dataset.d); },
  cancelarMov: async e => { const m = S.movs.find(x => x.id === e.dataset.id); const r = await perguntar({ titulo: 'Cancelar lançamento?', ph: 'motivo', obrig: true, ok: 'Cancelar', perigo: true }); S.sheet = null; if (!r) return render(); m.status = 'cancelada'; m.motivoCanc = r; await DB.put('movs', m); render(); },
  chipTexto: e => { const i = $('#sheet input[name=v]'); i.value = e.dataset.v; },
  iniciarContagem: async () => { const l = lote(); const ok = await perguntar({ titulo: 'Travar vendas e começar a contagem?', texto: 'Depois disso, este lote não aceita vendas novas. Antes, junte aqui as vendas dos outros caixas ("Receber caixa" na tela inicial).', ok: 'Travar e contar', semInput: true }); S.sheet = null; if (!ok) return render(); l.status = 'contagem'; l.retorno ||= {}; await saveLote(l); render(); },
  ret: async e => { const l = lote(); if (l.status === 'aberto') { toast('Primeiro toque em "Travar vendas"', null, true); return; } l.retorno ||= {}; const s = e.dataset.s; l.retorno[s] = Math.max(0, (l.retorno[s] || 0) + +e.dataset.d); await saveLote(l); const inp = document.querySelector(`input[data-in=ret][data-s="${CSS.escape(s)}"]`); if (inp) inp.value = l.retorno[s]; vibrate(10); },
  revelar: () => { const l = lote(); if (l.status === 'aberto') { toast('Primeiro toque em "Travar vendas"', null, true); return; } S.contagemRevelada = true; render(); window.scrollTo(0, 0); },
  recontar: () => { S.contagemRevelada = false; render(); },
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
  exportarCaixa: () => exportarCaixa(lote()),
  importarCaixa: () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.onchange = () => i.files[0] && receberCaixa(i.files[0]); i.click(); },
  contarCarga: async () => { const l = lote(); l.carga = {}; l.cargaManual = true; S.todoCatalogo = true; await saveLote(l); toast('Toque no produto, escolha cor e tamanho e informe a quantidade'); A.cargaManual(); },
  cargaManual: () => { S.sheet = { k: 'mov', tipo: '__carga' }; MOV.__carga = 'Carga'; renderSheet(); },
  precoModelo: async e => { const id = e.dataset.m; const ps = [...S.produtos.values()].filter(p => modeloDe(p) === id); const v = await perguntar({ titulo: 'Preço de show', texto: nomeModelo(ps[0]), tipo: 'num', valor: ps[0].precoShow ? String(ps[0].precoShow).replace('.', ',') : '', ph: 'vazio = preço do Tiny', ok: 'Salvar' }); S.sheet = null; if (v !== null && v !== undefined) { ps.forEach(p => p.precoShow = num(v) || 0); await DB.bulk('produtos', ps); } render(); },
  baixarFotos: () => baixarFotos(),
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
  if (k === 'cfg') { S.cfg.vendedor = fd.get('vendedor').trim(); S.cfg.caixa = fd.get('caixa').trim(); S.cfg.tema = fd.get('tema'); S.cfg.cfopBonif = fd.get('cfopBonif').trim(); S.cfg.cfopPerda = fd.get('cfopPerda').trim(); await saveCfg(); S.view = 'home'; render(); toast('Salvo'); }
  if (k === 'novoLote') {
    if (!S.cfg.vendedor) { S.cfg.vendedor = fd.get('resp'); saveCfg(); }
    const cs = fd.getAll('cidade'), us = fd.getAll('uf'), ds = fd.getAll('data'), es = fd.getAll('evento');
    const shows = cs.map((c, i) => ({ id: uid(), cidade: c.trim(), uf: us[i], data: ds[i], evento: (es[i] || '').trim() })).sort((a, b) => a.data.localeCompare(b.data));
    const l = { id: uid(), pedido: fd.get('pedido').trim(), resp: fd.get('resp').trim(), equipe: fd.get('equipe').trim(), shows, showAtual: shows[0].id, carga: {}, retorno: {}, obsDif: {}, status: 'aberto', criado: now(), seq: 0 };
    S.lotes.push(l); await saveLote(l); S.loteId = l.id; S.view = 'lote'; S.tab = 'vender'; render();
  }
  if (k === 'novoShow') { const l = lote(); const sh = { id: uid(), cidade: fd.get('cidade').trim(), uf: fd.get('uf'), data: fd.get('data'), evento: fd.get('evento').trim() }; l.shows.push(sh); l.showAtual = sh.id; await saveLote(l); S.sheet = null; render(); toast(`Agora vendendo em ${sh.cidade}/${sh.uf}`); }
  if (k === 'mov') salvarMov(fd);
});
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-a]'); if (el) { ev.preventDefault(); const fn = A[el.dataset.a]; fn && fn(el, ev); return; }
  if (ev.target.classList.contains('scrim')) A.fechar();
});
document.addEventListener('input', async ev => {
  const t = ev.target;
  if (t.dataset.in === 'busca') { S.busca = t.value; const pos = t.selectionStart; render(); const n = $('input[data-in=busca]'); n.focus(); n.setSelectionRange(pos, pos); }
  if (t.dataset.in === 'obsDif') { const l = lote(); l.obsDif ||= {}; l.obsDif[t.dataset.s] = t.value; await saveLote(l); return; }
  if (t.dataset.in === 'ret') { const l = lote(); if (l.status === 'aberto') { t.value = ''; toast('Primeiro toque em "Travar vendas"', null, true); return; } l.retorno ||= {}; if (t.value === '') delete l.retorno[t.dataset.s]; else l.retorno[t.dataset.s] = Math.max(0, Math.round(num(t.value))); await saveLote(l); }
});
document.addEventListener('change', async ev => {
  const t = ev.target; const f = t.files && t.files[0]; if (!f) return;
  try {
    if (t.dataset.in === 'catalogo') { const r = await importarCatalogo(f); toast(`${r.n} SKUs importados (${r.novos} novos)`); render(); }
    if (t.dataset.in === 'carga' && /\.pdf$/i.test(f.name)) { await lerCargaPdf(f, lote()); t.value = ''; return; }
    if (t.dataset.in === 'carga') { const r = await importarCarga(f, lote()); toast(`Carga: ${r.pecas} peças em ${r.linhas} SKUs${r.semCadastro ? ` · ${r.semCadastro} sem cadastro` : ''}`); render(); }
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
  const r0 = aba.linhas[0]; const cMeio = col(r0, k => k === 'meio - meio', k => k.includes('meio')); const cVal = col(r0, k => k.startsWith('valor')); const cSt = col(r0, k => k === 'status'); const cDt = col(r0, k => k.startsWith('data'));
  if (!cMeio || !cVal) throw new Error('Não achei as colunas "Meio" e "Valor (R$)" do extrato.');
  const vs = vendasLote(l); const ts = vs.map(v => +new Date(v.ts)).sort((a, b) => a - b);
  const de = ts.length ? ts[0] - 3 * 3600e3 : 0, ate = ts.length ? ts[ts.length - 1] + 3 * 3600e3 : Infinity;
  const dt = x => { if (x instanceof Date) return +x; if (typeof x === 'number') return Math.round((x - 25569) * 864e5) + new Date().getTimezoneOffset() * 6e4; const m = String(x).match(/(\d{2})\/(\d{2})\/(\d{4})[ T]?(\d{2})?:?(\d{2})?/); if (m) return +new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)); return +new Date(x); };
  const formas = {}; let n = 0;
  aba.linhas.forEach(r => { if (cSt && norm(r[cSt]) && !norm(r[cSt]).startsWith('aprov')) return; const t = cDt ? dt(r[cDt]) : 0; if (cDt && (t < de || t > ate)) return; const m = norm(r[cMeio]); const f = m.startsWith('pix') ? 'pix' : m.startsWith('cr') ? 'credito' : m.startsWith('d') ? 'debito' : null; if (!f) return; formas[f] = (formas[f] || 0) + num(r[cVal]); n++; });
  S.infinite = { loteId: l.id, formas, n, de: new Date(de).toISOString(), ate: isFinite(ate) ? new Date(ate).toISOString() : now() };
  l.conferenciaInfinite = S.infinite; await saveLote(l);
  toast(`${n} transações lidas da InfinitePay`);
}

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
    L.push([p.id || '', s, p.descricao || '', x.carga, x.vendido, x.vendido ? br(x.valor / x.vendido) : '', br(x.valor), x.mov, dif < 0 ? -dif : 0, dif > 0 ? dif : 0, fin ?? '', p.custo ? br(p.custo) : '', (l.obsDif || {})[s] || '']); });
  baixar(nomeArq(l) + '.csv', '﻿' + L.map(r => r.map(c => /[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}
// Três arquivos no layout "importar pedidos" do Tiny: venda (só o vendido, preço médio real), bonificação e perda (a custo).
const CAB_TINY = ['ID', 'Número do pedido', 'Data', 'Data prevista', 'ID contato', 'Nome do contato*', 'Tipo de Pessoa', 'CPF/CNPJ', 'RG/IE', 'CEP', 'Município', 'UF', 'Endereço', 'Endereço Nro', 'Complemento', 'Bairro', 'Fone', 'Celular', 'e-mail', 'Desconto pedido (% ou valor)', 'Frete', 'Observações', 'Situação', 'ID produto', 'Descrição', 'Quantidade', 'Valor unitário', 'Desconto item %', 'Código de rastreamento', 'Número da ordem de compra', 'Vendedor', 'Despesas', 'Desconto do pedido rateado', 'Frete pedido rateado', 'Despesas pedido rateado', 'Destinatário', 'CPF/CNPJ entrega', 'CEP entrega', 'Município entrega', 'UF entrega', 'Endereço entrega', 'Endereço Nro entrega', 'Complemento entrega', 'Bairro entrega', 'Fone entrega', 'Código (SKU)'];
function csvTinyPedido(l, tipo) {
  const sd = saldos(l); const ret = l.retorno || {}; const c = l.contatoTiny || { nome: 'Shows e Eventos' };
  const br = v => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',');
  const shows = (l.shows || []).map(s => `${s.cidade}/${s.uf} ${fmtD(s.data)}`).join('; ');
  const obs = { venda: `PDV Shows - venda do pedido ${l.pedido || ''} - ${shows}`, bonif: `PDV Shows - BONIFICACAO CFOP ${S.cfg.cfopBonif} - pedido ${l.pedido || ''} - ${shows}`, perda: `PDV Shows - PERDA NA CONTAGEM CFOP ${S.cfg.cfopPerda} - pedido ${l.pedido || ''} - ${shows}` }[tipo];
  const linhas = [];
  Object.entries(sd).filter(([, x]) => x.carga || x.vendido || x.mov).sort().forEach(([s, x]) => {
    const p = S.produtos.get(s) || {}; const dif = ret[s] === undefined ? 0 : ret[s] - x.saldo;
    let q = 0, v = 0;
    if (tipo === 'venda') { q = x.vendido; v = x.vendido ? x.valor / x.vendido : 0; }
    if (tipo === 'bonif') { q = x.mov; v = p.custo || 0; }
    if (tipo === 'perda') { q = dif < 0 ? -dif : 0; v = p.custo || 0; }
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
  baixar(`tiny-${tipo}-${nomeArq(l)}.csv`, [CAB_TINY, ...linhas].map(r => r.map(q).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
function exportarCaixa(l) {
  const pac = { tipo: 'caixa', versao: 1, em: now(), de: S.cfg.caixa, lote: l, vendas: S.vendas.filter(v => v.loteId === l.id), movs: S.movs.filter(m => m.loteId === l.id),
    produtos: [...S.produtos.values()].filter(p => (l.carga || {})[p.sku] !== undefined) };
  baixar(`${nomeArq(l)}-${norm(S.cfg.caixa || 'caixa').replace(/\s+/g, '-')}.json`, JSON.stringify(pac), 'application/json');
}
async function receberCaixa(file) {
  try {
    const pac = JSON.parse(await file.text()); if (!['caixa', 'backup'].includes(pac.tipo)) throw new Error('Arquivo não é de caixa do PDV');
    const lotes = pac.tipo === 'caixa' ? [pac.lote] : pac.lotes; let nv = 0, nm = 0;
    for (const p of pac.produtos || []) if (!S.produtos.has(p.sku)) { S.produtos.set(p.sku, p); await DB.put('produtos', p); }
    for (const l of lotes) { const meu = S.lotes.find(x => x.id === l.id);
      if (!meu) { S.lotes.push(l); await DB.put('lotes', l); }
      else { // junta shows; carga e contagem ficam com o caixa principal
        l.shows.forEach(s => { if (!meu.shows.find(x => x.id === s.id)) meu.shows.push(s); }); if (!Object.keys(meu.carga || {}).length) meu.carga = l.carga; await saveLote(meu); } }
    for (const v of pac.vendas || []) { const i = S.vendas.findIndex(x => x.id === v.id); if (i < 0) { S.vendas.push(v); nv++; await DB.put('vendas', v); } else if (v.status === 'cancelada' && S.vendas[i].status !== 'cancelada') { S.vendas[i] = v; await DB.put('vendas', v); } }
    for (const m of pac.movs || []) { const i = S.movs.findIndex(x => x.id === m.id); if (i < 0) { S.movs.push(m); nm++; await DB.put('movs', m); } else if (m.status === 'cancelada') { S.movs[i] = m; await DB.put('movs', m); } }
    render(); toast(`Recebido de ${pac.de || 'outro caixa'}: ${nv} vendas e ${nm} bonificações novas`);
  } catch (e) { toast(e.message || 'Arquivo inválido', null, true); }
}

// ---------- relatório PDF ----------
function relatorioHTML(l) {
  const r = resumo(l); const sd = saldos(l); const ret = l.retorno || {}; const fech = l.status === 'fechado'; const obs = l.obsDif || {};
  const linhas = Object.entries(sd).filter(([, x]) => x.carga || x.vendido || x.mov).map(([s, x]) => {
    const dif = ret[s] === undefined ? null : ret[s] - x.saldo;
    return { s, p: S.produtos.get(s) || { descricao: s }, ...x, ret: ret[s], dif, perda: dif < 0 ? -dif : 0, sobra: dif > 0 ? dif : 0 };
  }).sort((a, b) => (a.dif || 0) - (b.dif || 0) || (b.vendido + b.mov) - (a.vendido + a.mov) || a.s.localeCompare(b.s)); // divergências e movimentados primeiro
  const movs = movsLote(l); const inf = l.conferenciaInfinite;
  const semSaldo = vendasLote(l).flatMap(v => v.itens.filter(i => i.semSaldo).map(i => ({ ...i, num: v.num, motivo: i.semSaldo })));
  const descs = vendasLote(l).filter(v => v.desconto);
  const soma = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const custo = x => x.p.custo || 0;
  const vendidos = linhas.filter(x => x.vendido), bonif = linhas.filter(x => x.mov), perdas = linhas.filter(x => x.perda), sobras = linhas.filter(x => x.sobra);
  const dev = linhas.filter(x => x.ret);
  return `<div class="hdr"><div><img src="marca/logo-positivo.svg" alt="Indião Store"><div class="tit">Relatório de vendas em show · ${fech ? 'FINAL' : 'PARCIAL'}</div></div>
  <div style="text-align:right"><b>Pedido Tiny: ${esc(l.pedido || '—')}</b><br>Emitido em ${new Date().toLocaleString('pt-BR')}${fech ? '' : '<br><b>Lote ainda não fechado</b>'}</div></div>
  <h2>Lote</h2><table><tr><td class="l">Shows</td><td class="l">${(l.shows || []).map(s => `${esc(s.cidade)}/${s.uf} (${fmtD(s.data)}${s.evento ? ', ' + esc(s.evento) : ''})`).join('; ')}</td></tr>
  <tr><td class="l">Responsável / equipe</td><td class="l">${esc(l.resp)}${l.equipe ? ' · ' + esc(l.equipe) : ''}</td></tr>
  <tr><td class="l">Carga</td><td class="l">${Object.values(l.carga || {}).reduce((a, b) => a + b, 0)} peças · ${esc(l.cargaArquivo || (l.cargaManual ? 'contada no app' : '—'))}</td></tr>
  ${fech ? `<tr><td class="l">Fechamento</td><td class="l">${fmtDT(l.fechadoEm)} · conferido por ${esc(l.fechadoPor)}</td></tr>` : ''}</table>
  <h2>Resumo</h2><div class="k"><div><b>${brl(r.liq)}</b>vendas líquidas</div><div><b>${r.n}</b>vendas (${r.canc} canceladas)</div><div><b>${r.pecas}</b>peças vendidas</div><div><b>${brl(r.ticket)}</b>ticket médio</div></div>
  <p>Bruto ${brl(r.bruto)} · descontos ${brl(r.desc)} · bonificações ${soma(bonif, x => x.mov)} peças · perdas na contagem ${soma(perdas, x => x.perda)} peças · sobras ${soma(sobras, x => x.sobra)} peças</p>

  <h2>Baixas no Tiny (documentos separados)</h2>
  <table><thead><tr><th class="l">Documento</th><th class="l">CFOP</th><th>Peças</th><th>Valor</th><th class="l">Base do valor</th></tr></thead><tbody>
  <tr><td class="l">Pedido de venda (só o vendido)</td><td class="l">do pedido</td><td>${soma(vendidos, x => x.vendido)}</td><td>${brl(soma(vendidos, x => x.valor))}</td><td class="l">recebido, desconto rateado</td></tr>
  <tr><td class="l">Nota de bonificação</td><td class="l">${esc(S.cfg.cfopBonif)}</td><td>${soma(bonif, x => x.mov)}</td><td>${brl(soma(bonif, x => x.mov * custo(x)))}</td><td class="l">custo do cadastro</td></tr>
  <tr><td class="l">Nota de perda (contagem)</td><td class="l">${esc(S.cfg.cfopPerda)}</td><td>${soma(perdas, x => x.perda)}</td><td>${brl(soma(perdas, x => x.perda * custo(x)))}</td><td class="l">custo do cadastro</td></tr>
  <tr><td class="l">Retorno ao estoque</td><td class="l">—</td><td>${soma(dev, x => x.ret)}</td><td>—</td><td class="l">contagem física</td></tr>
  </tbody></table>
  <p class="foot">Bonificação e perda saem fora do pedido de venda, para não diluir o preço médio. Sobra (contado acima do esperado) não gera nota: confira a carga e as vendas do SKU.</p>

  <h2>Formas de pagamento</h2><table><thead><tr><th class="l">Forma</th><th>PDV</th>${inf ? '<th>InfinitePay</th><th>Diferença</th>' : ''}</tr></thead><tbody>
  ${FORMAS.map(f => { const a = r.formas[f.id] || 0; const b = inf ? (inf.formas[f.id] || 0) : 0; return `<tr><td class="l">${f.nome}</td><td>${brl(a)}</td>${inf ? (f.id === 'dinheiro' ? '<td>—</td><td>—</td>' : `<td>${brl(b)}</td><td class="${Math.abs(b - a) > .5 ? 'neg' : ''}">${brl(b - a)}</td>`) : ''}</tr>`; }).join('')}
  <tr><th class="l">Total</th><th>${brl(r.liq)}</th>${inf ? `<th>${brl(Object.values(inf.formas).reduce((a, b) => a + b, 0))}</th><th></th>` : ''}</tr></tbody></table>
  ${inf ? `<p class="foot">Extrato InfinitePay: ${inf.n} transações aprovadas entre ${fmtDT(inf.de)} e ${fmtDT(inf.ate)}. Dinheiro não passa pela InfinitePay: conferir com o caixa físico.</p>` : ''}

  <h2>Por show</h2><table><thead><tr><th class="l">Show</th><th>Vendas</th><th>Peças</th><th>Pix</th><th>Crédito</th><th>Débito</th><th>Dinheiro</th><th>Líquido</th></tr></thead><tbody>
  ${(l.shows || []).map(s => { const x = resumo(l, s.id); return `<tr><td class="l">${esc(s.cidade)}/${s.uf} · ${fmtD(s.data)}</td><td>${x.n}</td><td>${x.pecas}</td>${FORMAS.map(f => `<td>${brl(x.formas[f.id] || 0)}</td>`).join('')}<td><b>${brl(x.liq)}</b></td></tr>`; }).join('')}</tbody></table>

  ${perdas.length || sobras.length ? `<h2>Divergências da contagem</h2><table><thead><tr><th class="l">SKU</th><th class="l">Descrição</th><th>Esperado</th><th>Contado</th><th>Diferença</th><th class="l">Observação</th></tr></thead><tbody>
  ${[...perdas, ...sobras].map(x => `<tr><td class="l">${esc(x.s)}</td><td class="l">${esc(x.p.descricao)}</td><td>${x.saldo}</td><td>${x.ret ?? 0}</td><td class="${x.dif < 0 ? 'neg' : ''}">${x.dif > 0 ? '+' : ''}${x.dif}</td><td class="l">${esc(obs[x.s] || '—')}</td></tr>`).join('')}</tbody></table>` : ''}

  <h2>Itens por SKU</h2><table><thead><tr><th class="l">SKU</th><th class="l">Descrição</th><th>Carga</th><th>Venda</th><th>Preço médio</th><th>Total venda</th><th>Bonif.</th><th>Perda</th><th>Sobra</th><th>Retorno</th></tr></thead><tbody>
  ${linhas.map(x => `<tr><td class="l">${esc(x.s)}</td><td class="l">${esc(x.p.descricao)}</td><td>${x.carga}</td><td>${x.vendido}</td><td>${x.vendido ? brl(x.valor / x.vendido) : '—'}</td><td>${brl(x.valor)}</td><td>${x.mov}</td><td class="${x.perda ? 'neg' : ''}">${x.perda}</td><td>${x.sobra}</td><td>${x.ret ?? '—'}</td></tr>`).join('')}
  <tr><th class="l" colspan="2">Total</th><th>${soma(linhas, x => x.carga)}</th><th>${soma(linhas, x => x.vendido)}</th><th></th><th>${brl(soma(linhas, x => x.valor))}</th><th>${soma(linhas, x => x.mov)}</th><th>${soma(linhas, x => x.perda)}</th><th>${soma(linhas, x => x.sobra)}</th><th>${soma(linhas, x => x.ret || 0)}</th></tr></tbody></table>

  ${movs.length ? `<h2>Bonificações e retiradas (CFOP ${esc(S.cfg.cfopBonif)})</h2><table><thead><tr><th class="l">Data</th><th class="l">Tipo</th><th class="l">SKU</th><th>Qtd</th><th class="l">Autorizou</th><th class="l">Lançou</th><th class="l">Obs.</th></tr></thead><tbody>
  ${movs.map(m => `<tr><td class="l">${fmtDT(m.ts)}</td><td class="l">${esc(MOV[m.tipo] || m.tipo)}</td><td class="l">${esc(m.sku)}</td><td>${m.qtd}</td><td class="l">${esc(m.autorizou)}</td><td class="l">${esc(m.quem)}</td><td class="l">${esc(m.obs)}</td></tr>`).join('')}</tbody></table>` : ''}
  ${descs.length || semSaldo.length ? `<h2>Exceções</h2><table><tbody>${descs.map(v => `<tr><td class="l">Venda #${v.num}</td><td class="l">Desconto ${brl(v.desconto)} · ${esc(v.descMotivo)} · ${esc(v.vendedor)}</td></tr>`).join('')}${semSaldo.map(i => `<tr><td class="l">Venda #${i.num}</td><td class="l">${esc(i.sku)} vendido sem saldo na carga · ${esc(i.motivo)}</td></tr>`).join('')}</tbody></table>` : ''}
  <div class="sign"><div>Responsável pela venda</div><div>Conferente da contagem</div></div>
  <p class="foot">Gerado pelo PDV Shows Indião · caixa ${esc(S.cfg.caixa)} · ${vendasLote(l, true).length} registros de venda, ${S.movs.filter(m => m.loteId === l.id).length} de bonificação.</p>`;
}

// ---------- fotos offline, persistência, tela ligada ----------
async function baixarFotos() {
  const urls = [...new Set([...S.produtos.values()].map(p => p.img).filter(Boolean))]; const st = $('#fotosStatus');
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
addEventListener('online', render); addEventListener('offline', render);

// ---------- início ----------
(async function boot() {
  await DB.open();
  const [ps, ls, vs, ms, meta] = await Promise.all(['produtos', 'lotes', 'vendas', 'movs', 'meta'].map(s => DB.all(s)));
  ps.forEach(p => S.produtos.set(p.sku, p)); S.lotes = ls; S.vendas = vs; S.movs = ms;
  const cfg = meta.find(m => m.k === 'cfg'); if (cfg) S.cfg = { ...S.cfg, ...cfg.v };
  if (!S.cfg.aparelho) { S.cfg.aparelho = uid(); saveCfg(); }
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }
})();
