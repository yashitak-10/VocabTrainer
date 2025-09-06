/* ----------------- Constants & localStorage keys ----------------- */
const LS_WORDS = 'gvt_words_v5';
const LS_PROG = 'gvt_prog_v5';
const LS_THEME = 'gvt_theme_v5';
const LS_MESSAGES = 'gvt_messages_v5';

/* ----------------- Utility ----------------- */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,9); }
function saveJSON(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
function loadJSON(k, d=null){ try{ const s = localStorage.getItem(k); return s ? JSON.parse(s) : d; } catch(e){ return d; } }
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function normalizeCmp(s){ return (s||'').toString().trim().normalize('NFC').toLowerCase(); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]] } return a; }

/* ----------------- App state ----------------- */
let allWords = loadJSON(LS_WORDS, []);          // {id, Level, Article, German, Plural, English}
let progress = loadJSON(LS_PROG, {correct:0,seen:0,per:{}});

/* ----------------- DOM refs ----------------- */
const levelSelect = document.getElementById('levelSelect');
const modeSelect = document.getElementById('modeSelect');
const startBtn = document.getElementById('startBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const mainProgress = document.getElementById('mainProgress');
const progressText = document.getElementById('progressText');
const currentLevelBadge = document.getElementById('currentLevelBadge');

const displayWord = document.getElementById('displayWord');
const displayMeaning = document.getElementById('displayMeaning');
const actionArea = document.getElementById('actionArea');
const typingBox = document.getElementById('typingBox');
const typingInput = document.getElementById('typingInput');
const typingFeedback = document.getElementById('typingFeedback');
const specialKeys = document.getElementById('specialKeys');
const sessionProgress = document.getElementById('sessionProgress');
const sessionText = document.getElementById('sessionText');

const multiFiles = document.getElementById('multiFiles');
const uploadBtn = document.getElementById('uploadBtn');
const uploadLevel = document.getElementById('uploadLevel');
const uploadStatus = document.getElementById('uploadStatus');
const downloadTemplate = document.getElementById('downloadTemplate');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const resetProgressBtn = document.getElementById('resetProgressBtn');

const singleFile = document.getElementById('singleFile');
const singleAssign = document.getElementById('singleAssign');
const singleUploadBtn = document.getElementById('singleUploadBtn');
const singleStatus = document.getElementById('singleStatus');

const revSearch = document.getElementById('revSearch');
const revLevel = document.getElementById('revLevel');
const revBody = document.getElementById('revBody');
const revPrev = document.getElementById('revPrev');
const revNext = document.getElementById('revNext');
const revPageInfo = document.getElementById('revPageInfo');
const revRefresh = document.getElementById('revRefresh');

const contactName = document.getElementById('contactName');
const contactEmail = document.getElementById('contactEmail');
const contactMessage = document.getElementById('contactMessage');
const contactSave = document.getElementById('contactSave');
const contactSend = document.getElementById('contactSend');
const contactStatus = document.getElementById('contactStatus');

const themeBtn = document.getElementById('themeBtn');
const datasetInfo = document.getElementById('datasetInfo');

/* session */
let pool = [];         // filtered session items
let mode = 'flash';    // flash, mcq, type
let idx = 0;
let sessionCorrect = 0;
const REV_PAGE_SIZE = 50;
let revPage = 1;

/* ----------------- Helpers ----------------- */
function saveAll(){ saveJSON(LS_WORDS, allWords); if(datasetInfo) datasetInfo.textContent = `Saved: ${allWords.length} words (local)`; }
function saveProg(){ saveJSON(LS_PROG, progress); }

/* Theme toggle */
let currentTheme = localStorage.getItem(LS_THEME) || 'dark';
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
  if(themeBtn) themeBtn.textContent = t === 'light' ? '🌞' : '🌙';
  localStorage.setItem(LS_THEME, t);
}
applyTheme(currentTheme);
if(themeBtn) themeBtn.addEventListener('click', ()=> { currentTheme = (currentTheme==='dark') ? 'light' : 'dark'; applyTheme(currentTheme); });

/* ----------------- CSV parsing helpers ----------------- */
function csvSplit(line){
  const arr=[]; let cur=''; let inQuotes=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch === '"'){ inQuotes = !inQuotes; continue; }
    if(ch === ',' && !inQuotes){ arr.push(cur); cur=''; continue; }
    cur += ch;
  }
  arr.push(cur);
  return arr.map(x => x.trim());
}

async function parseCSVText(text, onProgress){
  if(!text) return [];
  if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  if(lines.length===0) return [];
  const firstCols = csvSplit(lines[0]).map(h => h.toLowerCase());
  const hasHeader = firstCols.includes('german') && firstCols.includes('english');
  const headerCols = hasHeader ? firstCols : null;
  const startIndex = hasHeader ? 1 : 0;
  const chunkSize = 2000;
  const result = [];
  for(let i=startIndex;i<lines.length;i+=chunkSize){
    const slice = lines.slice(i, i+chunkSize);
    for(const ln of slice){
      if(!ln || !ln.trim()) continue;
      const cols = csvSplit(ln);
      let rec={};
      if(hasHeader){
        rec.Level = cols[headerCols.indexOf('level')] || '';
        rec.Article = cols[headerCols.indexOf('article')] || '';
        rec.German = cols[headerCols.indexOf('german')] || '';
        rec.Plural = cols[headerCols.indexOf('plural')] || '';
        rec.English = cols[headerCols.indexOf('english')] || '';
      } else {
        rec.Level = cols[0] || '';
        rec.Article = cols[1] || '';
        rec.German = cols[2] || '';
        rec.Plural = cols[3] || '';
        rec.English = cols[4] || '';
      }
      if(!(rec.German && rec.English)) continue;
      if(rec.German.toLowerCase()==='german' && rec.English.toLowerCase()==='english') continue;
      result.push(rec);
    }
    if(onProgress) onProgress(Math.min(lines.length, i+chunkSize), lines.length);
    await sleep(0);
  }
  return result;
}

/* ----------------- Upload handlers ----------------- */
if(uploadBtn) uploadBtn.addEventListener('click', async ()=>{
  const files = Array.from(multiFiles.files || []);
  if(files.length === 0){ uploadStatus.textContent = 'No files selected'; return; }
  uploadStatus.textContent = 'Processing...';
  let totalAdded = 0;
  for(const f of files){
    try{
      const text = await f.text();
      const rows = await parseCSVText(text, (p,t)=> uploadStatus.textContent = `Parsing ${f.name}: ${p}/${t} lines`);
      let assign = uploadLevel.value || 'AUTO';
      let lvl = assign;
      if(assign === 'AUTO'){
        const name = (f.name || '').toUpperCase();
        const found = ['A1','A2','B1','B2','C1','C2'].find(x => name.includes(x));
        lvl = found || 'OTHERS';
      }
      const prepared = rows.map(r => ({
        id: uid(),
        Level: (r.Level || lvl || '').toString().toUpperCase(),
        Article: r.Article || '',
        German: r.German || '',
        Plural: r.Plural || '',
        English: r.English || ''
      })).filter(r => r.German && r.English);
      allWords = allWords.concat(prepared);
      totalAdded += prepared.length;
      saveAll();
      await sleep(80);
    } catch(err){
      console.error('file parse err', err);
    }
  }
  rebuildPool(); renderRevPage(); updateSessionUI();
  uploadStatus.textContent = `Imported ${totalAdded} rows from ${files.length} file(s)`;
});

if(downloadTemplate) downloadTemplate.addEventListener('click', ()=>{
  const sample = 'Level,Article,German,Plural,English\nA1,der,Hund,Hunde,dog\nA1,die,Katze,Katzen,cat\n';
  const blob = new Blob([sample], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'vocab_template.csv'; a.click(); URL.revokeObjectURL(url);
});

if(singleUploadBtn) singleUploadBtn.addEventListener('click', async ()=>{
  const f = singleFile.files[0];
  if(!f){ singleStatus.textContent = 'Select a file first'; return; }
  singleStatus.textContent = 'Processing...';
  try{
    const text = await f.text();
    const rows = await parseCSVText(text, (p,t)=> singleStatus.textContent = `Parsing ${f.name}: ${p}/${t}`);
    let assign = singleAssign.value || 'AUTO';
    let lvl = assign;
    if(assign === 'AUTO'){
      const name = (f.name || '').toUpperCase();
      const found = ['A1','A2','B1','B2','C1','C2'].find(x => name.includes(x));
      lvl = found || 'OTHERS';
    }
    const prepared = rows.map(r=>({ id: uid(), Level: (r.Level||lvl).toUpperCase(), Article: r.Article||'', German: r.German||'', Plural: r.Plural||'', English: r.English||'' })).filter(r=>r.German && r.English);
    allWords = allWords.concat(prepared);
    saveAll();
    rebuildPool(); renderRevPage(); updateSessionUI();
    singleStatus.textContent = `Imported ${prepared.length} rows assigned to ${lvl}`;
  }catch(e){
    console.error(e);
    singleStatus.textContent = 'Error reading file';
  }
});

/* Export / Clear / Reset */
if(exportBtn) exportBtn.addEventListener('click', ()=>{
  const header = 'Level,Article,German,Plural,English\n';
  const body = allWords.map(r => {
    const fields = [r.Level || '', r.Article || '', r.German || '', r.Plural || '', r.English || ''];
    return fields.map(f => /[",\n]/.test(f) ? '"' + f.replace(/"/g,'""') + '"' : f).join(',');
  }).join('\n');
  const blob = new Blob([header + body], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'german_vocab_export.csv'; a.click(); URL.revokeObjectURL(url);
});

if(clearBtn) clearBtn.addEventListener('click', ()=>{
  if(!confirm('Clear ALL words from local storage?')) return;
  allWords = []; saveAll(); rebuildPool(); renderRevPage(); renderCurrent();
});

if(resetProgressBtn) resetProgressBtn.addEventListener('click', ()=>{
  if(!confirm('Reset stored progress?')) return;
  progress = {correct:0, seen:0, per:{}}; saveProg(); sessionCorrect = 0; updateSessionUI();
});

/* ----------------- Pool & Trainer logic ----------------- */
function rebuildPool(){
  const lv = (levelSelect.value || 'ALL');
  if(currentLevelBadge) currentLevelBadge.textContent = lv;
  pool = (lv === 'ALL') ? allWords.slice() : allWords.filter(w => (w.Level || '').toUpperCase() === lv);
  idx = 0; sessionCorrect = 0; updateSessionUI();
}

function updateSessionUI(){
  const total = pool.length;
  const pct = total ? Math.round((sessionCorrect / total) * 100) : 0;
  if(sessionProgress) sessionProgress.style.width = pct + '%';
  if(sessionText) sessionText.textContent = `${Math.min(idx,total)} / ${total} • ✓ ${sessionCorrect}`;
  if(mainProgress) mainProgress.style.width = pct + '%';
  if(progressText) progressText.textContent = `${Math.min(idx,total)} / ${total} • ✓ ${sessionCorrect}`;
  if(currentLevelBadge) currentLevelBadge.textContent = levelSelect.value || 'ALL';
}

if(startBtn) startBtn.addEventListener('click', ()=> {
  mode = modeSelect.value || 'flash';
  rebuildPool();
  if(pool.length === 0){ alert('No words loaded. Import CSV first.'); renderCurrent(); return; }
  pool = shuffle(pool.slice());
  idx = 0; sessionCorrect = 0; updateSessionUI();
  renderCurrent();
});

if(shuffleBtn) shuffleBtn.addEventListener('click', ()=> {
  pool = shuffle(pool.slice()); idx = 0; sessionCorrect = 0; updateSessionUI(); renderCurrent();
});

/* SINGLE renderCurrent (clean and used everywhere) */
function renderCurrent(){
  updateSessionUI();
  if(pool.length === 0){
    if(displayWord) displayWord.textContent = 'No words loaded. Please upload CSV.';
    if(displayMeaning) displayMeaning.textContent = '';
    if(actionArea) actionArea.innerHTML = '';
    if(typingBox) typingBox.style.display = 'none';
    return;
  }

  if(idx >= pool.length){
    if(displayWord) displayWord.textContent = 'Session finished 🎉';
    if(displayMeaning) displayMeaning.textContent = '';
    if(actionArea) actionArea.innerHTML = `<div style="text-align:center"><button class="btn" id="restartBtn">Restart</button></div>`;
    if(typingBox) typingBox.style.display = 'none';
    const restartBtn = document.getElementById('restartBtn');
    if(restartBtn) restartBtn.addEventListener('click', ()=> { idx = 0; sessionCorrect = 0; renderCurrent(); });
    return;
  }

  const w = pool[idx];
  if(!w){
    displayWord.textContent = 'No valid item';
    return;
  }

  if(mode === 'type'){
    displayWord.textContent = w.English || '[missing English]';
  } else {
    displayWord.textContent = ((w.Article || '').trim() ? (w.Article + ' ') : '') + w.German;
  }
  displayMeaning.textContent = '';
  typingBox.style.display = (mode === 'type') ? 'block' : 'none';
  typingInput.value = '';
  typingFeedback.textContent = '';
  actionArea.innerHTML = '';

  if(mode === 'flash') renderFlash(w);
  if(mode === 'mcq') renderMCQ(w);
  if(mode === 'type') renderType(w);
}

/* Flash */
function renderFlash(w){
  const wrapper = document.createElement('div');
  wrapper.className = 'actions';
  const flip = document.createElement('button'); flip.className='btn'; flip.textContent='Show meaning';
  const knew = document.createElement('button'); knew.className='btn ghost'; knew.textContent='I knew it';
  const dont = document.createElement('button'); dont.className='btn ghost'; dont.textContent="I need practice";
  const next = document.createElement('button'); next.className='btn ghost'; next.textContent='Next';
  const speakBtn = document.createElement('button'); speakBtn.className='btn ghost'; speakBtn.textContent='🔊';

  flip.addEventListener('click', ()=> { displayMeaning.textContent = w.English + (w.Plural ? ' • Plural: ' + w.Plural : ''); });
  knew.addEventListener('click', ()=> { sessionCorrect++; progress.correct = (progress.correct||0) + 1; progress.per[w.id] = (progress.per[w.id]||0) + 1; saveProg(); idx++; renderCurrent(); });
  dont.addEventListener('click', ()=> { idx++; renderCurrent(); });
  next.addEventListener('click', ()=> { idx++; renderCurrent(); });
  speakBtn.addEventListener('click', ()=> speak(((w.Article||'') + ' ' + w.German).trim()));

  wrapper.appendChild(flip); wrapper.appendChild(knew); wrapper.appendChild(dont); wrapper.appendChild(next); wrapper.appendChild(speakBtn);
  actionArea.appendChild(wrapper);
}

/* MCQ */
function renderMCQ(w){
  const opts = new Set([w.English]);
  let attempts = 0;
  while(opts.size < 4 && attempts < 200 && allWords.length > 0){
    const r = allWords[Math.floor(Math.random() * allWords.length)].English;
    if(r) opts.add(r);
    attempts++;
  }
  const arr = shuffle(Array.from(opts));
  const grid = document.createElement('div'); grid.className='mcq-grid';
  arr.forEach(opt => {
    const d = document.createElement('div'); d.className='opt'; d.textContent = opt;
    d.addEventListener('click', ()=>{
      if(d.classList.contains('answered')) return;
      d.classList.add('answered');
      if(opt === w.English){
        d.classList.add('correct'); sessionCorrect++; progress.correct = (progress.correct||0)+1; progress.per[w.id] = (progress.per[w.id]||0)+1; saveProg();
      } else {
        d.classList.add('wrong');
        Array.from(grid.children).forEach(c => { if(c.textContent === w.English) c.classList.add('correct'); });
      }
      idx++; updateSessionUI();
      setTimeout(()=> renderCurrent(), 800);
    });
    grid.appendChild(d);
  });
  actionArea.appendChild(grid);
}

/* Typing */
function buildSpecialKeys(){
  specialKeys.innerHTML = '';
  const keys = ["ä","ö","ü","Ä","Ö","Ü","ß"];
  keys.forEach(ch => {
    const b = document.createElement('button'); b.type='button'; b.className='key'; b.textContent=ch;
    b.addEventListener('click', ()=> {
      const el = typingInput;
      const s = el.selectionStart || 0, e = el.selectionEnd || 0;
      el.value = el.value.slice(0,s) + ch + el.value.slice(e);
      el.focus(); el.selectionStart = el.selectionEnd = s + ch.length;
    });
    specialKeys.appendChild(b);
  });
}

function renderType(w){
  buildSpecialKeys();
  const info = document.createElement('div'); info.className='small'; info.textContent = 'Type the German form including article (e.g. der Hund). Case-insensitive.';
  actionArea.appendChild(info);
}

if(document.getElementById('typingCheck')) document.getElementById('typingCheck').addEventListener('click', ()=>{
  if(pool.length === 0) return;
  const w = pool[idx];
  const expected = ((w.Article || '') + ' ' + (w.German || '')).trim().normalize('NFC');
  const val = (typingInput.value || '').trim().normalize('NFC');
  const synonyms = allWords.filter(x => normalizeCmp(x.English) === normalizeCmp(w.English));
  const accepted = synonyms.map(x => ((x.Article||'') + ' ' + (x.German||'')).trim());

  if(accepted.some(ans => normalizeCmp(val) === normalizeCmp(ans))){
    typingFeedback.innerHTML = `<span style="color:var(--success)">✅ Correct</span>`;
    sessionCorrect++;
    progress.correct = (progress.correct||0)+1;
    progress.per[w.id] = (progress.per[w.id]||0)+1;
    saveProg();
  } else {
    typingFeedback.innerHTML = `<span style="color:var(--danger)">❌ Wrong</span> — Correct options: <b>${accepted.join(' | ')}</b>`;
    if(w.Plural) typingFeedback.innerHTML += ` • Plural: ${escapeHtml(w.Plural)}`;
  }

  idx++; updateSessionUI();
  setTimeout(()=> renderCurrent(), 900);
});

if(document.getElementById('typingReveal')) document.getElementById('typingReveal').addEventListener('click', ()=>{
  if(pool.length === 0) return;
  const w = pool[idx];
  typingFeedback.textContent = ((w.Article || '') + ' ' + w.German + (w.Plural ? ' • Plural: ' + w.Plural : '')).trim();
  typingFeedback.style.color = 'var(--muted)';
});

/* keyboard shortcuts */
window.addEventListener('keydown', (e)=>{
  if(e.code === 'Space' && mode === 'flash'){ e.preventDefault(); const flip = actionArea.querySelector('.btn'); if(flip) flip.click(); }
  if(mode === 'mcq' && ['Digit1','Digit2','Digit3','Digit4'].includes(e.code)){
    const n = Number(e.code.slice(-1)) - 1; const opts = document.querySelectorAll('.mcq-grid .opt'); if(opts[n]) opts[n].click();
  }
  if(mode === 'type' && e.key === 'Enter'){ e.preventDefault(); document.getElementById('typingCheck').click(); }
});

/* speak TTS */
function speak(text){
  if(!text) return;
  try{
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    u.rate = 0.95;
    const voices = speechSynthesis.getVoices();
    const germanVoice = voices.find(v => v.lang && v.lang.startsWith && v.lang.startsWith('de'));
    if(germanVoice) u.voice = germanVoice;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }catch(e){ console.error('TTS error', e); }
}

/* ----------------- Revision (pagination 50) ----------------- */
function getFilteredRows(){
  const q = (revSearch.value||'').toLowerCase().trim();
  const lvl = (revLevel.value || 'ALL');
  return allWords.filter(r=>{
    if(lvl !== 'ALL' && (r.Level||'').toUpperCase() !== lvl) return false;
    if(!q) return true;
    return ((r.German||'') + ' ' + (r.English||'')).toLowerCase().includes(q);
  });
}

function renderRevPage(){
  const rows = getFilteredRows();
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / REV_PAGE_SIZE));
  if(revPage > totalPages) revPage = totalPages;
  const start = (revPage - 1) * REV_PAGE_SIZE;
  const pageRows = rows.slice(start, start + REV_PAGE_SIZE);

  revBody.innerHTML = '';
  for(const r of pageRows){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(r.Level||'')}</td>
      <td>${escapeHtml(r.Article||'')}</td>
      <td>${escapeHtml(r.German||'')}</td>
      <td>${escapeHtml(r.Plural||'')}</td>
      <td>${escapeHtml(r.English||'')}</td>
      <td><button class="play-btn">🔊</button></td>`;
    tr.querySelector('.play-btn').addEventListener('click', ()=> speak(((r.Article||'') + ' ' + r.German).trim()));
    revBody.appendChild(tr);
  }
  revPageInfo.textContent = `Page ${revPage} / ${totalPages} (${total} words)`;
  revPrev.disabled = revPage <= 1;
  revNext.disabled = revPage >= totalPages;
}

if(revSearch) revSearch.addEventListener('input', ()=> { revPage = 1; renderRevPage(); });
if(revLevel) revLevel.addEventListener('change', ()=> { revPage = 1; renderRevPage(); });
if(revRefresh) revRefresh.addEventListener('click', ()=> { revPage = 1; renderRevPage(); });
if(revPrev) revPrev.addEventListener('click', ()=> { if(revPage>1){ revPage--; renderRevPage(); }});
if(revNext) revNext.addEventListener('click', ()=> { revPage++; renderRevPage(); });

/* ----------------- Contact handlers ----------------- */
if(contactSave) contactSave.addEventListener('click', ()=>{
  const name = contactName.value.trim();
  const email = contactEmail.value.trim();
  const message = contactMessage.value.trim();
  if(!name || !email || !message){ contactStatus.textContent = 'Fill all fields'; return; }
  const msgs = loadJSON(LS_MESSAGES, []);
  msgs.push({id: uid(), name, email, message, created: new Date().toISOString()});
  saveJSON(LS_MESSAGES, msgs);
  contactStatus.textContent = 'Saved locally. Connect EmailJS later to send.';
  contactName.value = contactEmail.value = contactMessage.value = '';
});

if(contactSend) contactSend.addEventListener('click', ()=>{ contactSave.click(); });

/* ----------------- Helpers & initial render ----------------- */
function rebuildPoolAndUI(){ rebuildPool(); renderCurrent(); renderRevPage(); updateSessionUI(); }

rebuildPool();
renderRevPage();
updateSessionUI();

/* ----------------- Expose for debugging ----------------- */
window.vocabApp = {
  getAllWords: () => allWords,
  rebuildPool,
  renderRevPage,
  saveAll,
  loadJSON,
  clearLocal: () => { localStorage.removeItem(LS_WORDS); localStorage.removeItem(LS_PROG); location.reload(); }
};

/* scroll helper */
function scrollToSection(id){ const el = document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth'}); }
window.scrollToSection = scrollToSection;
