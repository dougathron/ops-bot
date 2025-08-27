// app.js — UI and interactions
import { KB, ingestFiles, actionFindSection, actionFindProcedure, actionSummarizeSOP, actionWhoDoesWhat } from './rag.js';

const gate = document.getElementById('gate');
const app = document.getElementById('app');
const fileInput = document.getElementById('fileInput');
const ingestStatus = document.getElementById('ingestStatus');
const browser = document.getElementById('browser');
const answers = document.getElementById('answers');
const question = document.getElementById('question');
const askBtn = document.getElementById('askBtn');
const micBtn = document.getElementById('micBtn');
const replyStyle = document.getElementById('replyStyle');

let CFG = null;

(async function init(){
  CFG = await fetch('config.json').then(r=>r.json());
  replyStyle.value = CFG.default_reply_style || 'neutral';
})();

// Simple passphrase gate using SHA-256
document.getElementById('enterBtn').onclick = async () => {
  const val = document.getElementById('passphrase').value || '';
  const sha = await sha256(val);
  if (!CFG.passphrase_sha256 || CFG.passphrase_sha256 === sha) {
    // On first run: set passphrase if empty
    if (!CFG.passphrase_sha256 && val) {
      CFG.passphrase_sha256 = sha;
      await fetch('config.json', {method:'GET'}); // noop — cannot write on Pages; tell owner to edit file locally for permanence
    }
    gate.classList.add('hidden'); app.classList.remove('hidden');
  } else {
    alert('Incorrect passphrase');
  }
};

fileInput.addEventListener('change', async (e)=>{
  const files = Array.from(e.target.files);
  await ingestFiles(files, ingestStatus);
  renderBrowser();
});

function renderBrowser(){
  browser.innerHTML = '';
  const sections = KB.nodes.filter(n=>n.type==='section');
  for (const sec of sections) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    const procs = KB.nodes.filter(n=>n.type==='procedure' && n.parent===sec.id);
    tile.innerHTML = `<h4>Section: ${esc(sec.title)}</h4>` +
      (procs.length? `<ul>${procs.map(p=>`<li>${esc(p.title)}</li>`).join('')}</ul>` : '<p><em>No procedures found.</em></p>');
    browser.appendChild(tile);
  }
}

document.querySelectorAll('.quick-prompts button').forEach(b=>{
  b.addEventListener('click', ()=>{
    const intent = b.dataset.intent;
    const text = promptLabel(intent);
    const name = prompt(`Enter the ${intent.includes('section')?'section':'procedure'} name:`);
    if (!name) return;
    handleIntent(intent, name);
  });
});

askBtn.onclick = () => {
  const q = question.value.trim();
  if (!q) return;
  addUserMsg(q);
  // naive route: choose intent by keywords
  const lower = q.toLowerCase();
  if (lower.startsWith('find a section')) {
    const name = q.split(':').slice(1).join(':').trim() || prompt('Section name?');
    handleIntent('find_section', name);
  } else if (lower.startsWith('find a procedure')) {
    const name = q.split(':').slice(1).join(':').trim() || prompt('Procedure name?');
    handleIntent('find_procedure', name);
  } else if (lower.startsWith('summarize') || lower.includes('flowchart')) {
    const name = q.split(':').slice(1).join(':').trim() || prompt('SOP/Procedure name?');
    handleIntent('summarize_sop', name);
  } else if (lower.includes('who does what') || lower.includes('rasci')) {
    const name = q.split(':').slice(1).join(':').trim() || prompt('SOP/Procedure name?');
    handleIntent('who_does_what', name);
  } else {
    // generic retrieval
    genericAnswer(q);
  }
  question.value='';
};

// Voice input (hold to talk)
let rec=null, speaking=false;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false;
  micBtn.onmousedown = ()=>{ rec.start(); micBtn.textContent='🎙️ Listening…'; };
  micBtn.onmouseup = ()=>{ rec.stop(); micBtn.textContent='🎤 Hold to talk'; };
  rec.onresult = (e)=>{
    const t = e.results[0][0].transcript;
    question.value = t; askBtn.click();
  };
} else {
  micBtn.disabled = true; micBtn.title = 'Speech recognition not supported in this browser';
}

function addUserMsg(text){ const d=document.createElement('div'); d.className='msg'; d.innerHTML = `<b>You:</b> ${esc(text)}`; answers.appendChild(d); answers.scrollTop=answers.scrollHeight;}
function addBotMsg(html){ const d=document.createElement('div'); d.className='msg'; d.innerHTML = `<b>Agent:</b> ${html}`; answers.appendChild(d); answers.scrollTop=answers.scrollHeight; speakIfNeeded(d.innerText);}

function handleIntent(intent, name){
  if (intent==='find_section') {
    const r = actionFindSection(name);
    if (r.exact) {
      const list = r.list.length? '<ul>'+r.list.map(t=>`<li>${esc(t)}</li>`).join('')+'</ul>' : '<em>No procedures found in this section.</em>';
      addBotMsg(`<div><div><b>${esc(name)}</b> — procedures:</div>${list}</div>`);
    } else {
      addBotMsg(`${esc(CFG.prompts.find_section.fallback)}<br><br>Closest: ${ (r.near||[]).map(esc).join(' • ') || '<em>none</em>' }`);
    }
  }
  if (intent==='find_procedure') {
    const r = actionFindProcedure(name);
    if (r.exact) {
      const list = r.subs.length? '<ul>'+r.subs.map(t=>`<li>${esc(t)}</li>`).join('')+'</ul>' : `<em>${esc(CFG.prompts.find_procedure.no_subs)}</em>`;
      addBotMsg(`<div><div><b>${esc(name)}</b> — sub-procedures:</div>${list}</div>`);
    } else {
      addBotMsg(`${esc(CFG.prompts.find_procedure.fallback)}<br><br>Closest: ${ (r.near||[]).map(esc).join(' • ') || '<em>none</em>' }`);
    }
  }
  if (intent==='summarize_sop') {
    const r = actionSummarizeSOP(name);
    if (r.target) {
      if (r.images.length) {
        const imgs = r.images.map(u=>tryImg(u)).join('');
        addBotMsg(`<div>Flowchart(s) for <b>${esc(r.target.title)}</b>:<br>${imgs}<br><small>${esc(CFG.prompts.summarize_sop.image_note)}</small></div>`);
      } else {
        addBotMsg(`${esc(CFG.prompts.summarize_sop.fallback)}`);
      }
    } else {
      addBotMsg(`${esc(CFG.prompts.summarize_sop.fallback)}`);
    }
  }
  if (intent==='who_does_what') {
    const r = actionWhoDoesWhat(name);
    if (r.target) {
      if (r.rasci.length) {
        const imgs = r.rasci.map(u=>tryImg(u)).join('');
        addBotMsg(`<div>RASCI for <b>${esc(r.target.title)}</b>:<br>${imgs}<br><small>${esc(CFG.prompts.who_does_what.image_note)}</small></div>`);
      } else {
        addBotMsg(`${esc(CFG.prompts.who_does_what.fallback)}`);
      }
    } else {
      addBotMsg(`${esc(CFG.prompts.who_does_what.fallback)}`);
    }
  }
}

function genericAnswer(q){
  // retrieve top chunks and display quotes
  const {search} = awaitImport('./vector.js');
  const hits = search(window.__KBINDEX || KB.index, q, 5);
  if (!hits || !hits.length) { addBotMsg('No relevant content found.'); return; }
  const html = hits.map(h=>`<div><b>${esc(h.meta.path)}</b><br><small>Snippet:</small><br>${esc(h.meta.text.slice(0,300))}…</div>`).join('<hr>');
  addBotMsg(html);
}

function tryImg(url){
  // Render image if CORS allows; otherwise show link
  const safe = esc(url);
  return `<div><img src="${safe}" alt="image" onerror="this.outerHTML='<a class=link href=${safe} target=_blank>Open image</a>'" style="max-width:100%;border-radius:10px;border:1px solid #223063;margin:6px 0"/></div>`;
}

function promptLabel(intent){
  return (CFG.prompts[intent]?.label) || intent;
}

function esc(s){return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

async function sha256(str){
  const enc = new TextEncoder(); const data = enc.encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function awaitImport(path){ return await import(path); }
