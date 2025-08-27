// rag.js — document ingestion + SOP tree + actions
import { tfidfIndex, search } from './vector.js';

export const KB = {
  nodes: [], // flat nodes with {id, type:'section'|'procedure'|'sub', title, text, anchors, links}
  chunks: [], // for retrieval: {id, text, path, type}
  index: null
};

export async function ingestFiles(files, statusEl) {
  KB.nodes = []; KB.chunks = []; KB.index = null;
  let count = 0;
  for (const file of files) {
    const ext = file.name.toLowerCase().split('.').pop();
    statusEl.textContent = `Reading ${file.name}…`;
    try {
      if (ext === 'pdf') {
        await ingestPDF(file);
      } else if (ext === 'docx') {
        await ingestDOCX(file);
      } else if (ext === 'txt') {
        await ingestTXT(file);
      } else {
        console.warn('Skipping unsupported', file.name);
      }
      count++;
    } catch (e) {
      console.error('Ingest error', e);
    }
  }
  statusEl.textContent = `Indexed ${count} file(s). Building search index…`;
  KB.index = tfidfIndex(KB.chunks);
  statusEl.textContent = `Ready. ${KB.nodes.length} items, ${KB.chunks.length} chunks.`;
}

async function ingestTXT(file) {
  const text = await file.text();
  parseTextToSOP(text, file.name);
}

async function ingestDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const doc = await window.docx.parseDocx(arrayBuffer);
  const text = doc.text || '';
  parseTextToSOP(text, file.name);
}

async function ingestPDF(file) {
  const pdfjsLib = await import('./vendor/pdf.mjs');
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({data}).promise;
  let full = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const str = content.items.map(i => i.str).join(' ');
    full += '\n' + str;
  }
  parseTextToSOP(full, file.name);
}

// Heuristic parse: headings "Section:", "Procedure:", "Sub-procedure:" or H1/H2 markers
function parseTextToSOP(text, source) {
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  let currentSection = null, currentProcedure = null;

  function addNode(type, title) {
    const id = KB.nodes.length + 1;
    const node = { id, type, title, text: '', source, anchors: [], links: [] };
    KB.nodes.push(node);
    return node;
  }

  for (const line of lines) {
    const secMatch = line.match(/^(Section|SECTION)\s*[:\-]\s*(.+)$/);
    const procMatch = line.match(/^(Procedure|PROCEDURE)\s*[:\-]\s*(.+)$/);
    const subMatch = line.match(/^(Sub-?procedure|SUB-?PROCEDURE)\s*[:\-]\s*(.+)$/);
    const h1 = line.match(/^#\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const h3 = line.match(/^###\s+(.+)$/);

    if (secMatch || h1) {
      currentSection = addNode('section', (secMatch?secMatch[2]:h1[1]).trim());
      currentProcedure = null;
      continue;
    }
    if (procMatch || h2) {
      currentProcedure = addNode('procedure', (procMatch?procMatch[2]:h2[1]).trim());
      currentSection = currentSection || addNode('section', 'Unsorted');
      currentProcedure.parent = currentSection.id;
      continue;
    }
    if (subMatch || h3) {
      const sub = addNode('sub', (subMatch?subMatch[2]:h3[1]).trim());
      const parent = currentProcedure || currentSection || addNode('section','Unsorted');
      sub.parent = parent.id;
      continue;
    }
    // body text
    const node = (currentProcedure && KB.nodes.find(n=>n.id===KB.nodes.at(-1).id && n.type!=='section'))
              || currentProcedure || currentSection;
    if (node) node.text += line + '\n';
  }

  // Create chunks for retrieval
  for (const n of KB.nodes) {
    const path = titlePath(n);
    const chunkText = `[${n.type.toUpperCase()}] ${path}\n${n.text.slice(0, 2000)}`;
    KB.chunks.push({ id: n.id, text: chunkText, path, type: n.type });
  }
}

function titlePath(node) {
  let parts = [node.title];
  let cur = node;
  while (cur.parent) {
    const p = KB.nodes.find(n=>n.id===cur.parent);
    if (!p) break;
    parts.unshift(p.title);
    cur = p;
  }
  return parts.join(' › ');
}

// Actions implementing your 4 prompts
export function actionFindSection(name) {
  const exact = KB.nodes.filter(n=>n.type==='section' && eq(n.title,name));
  if (exact.length) {
    const procs = KB.nodes.filter(n=>n.type==='procedure' && n.parent===exact[0].id);
    return { exact: exact[0], list: procs.map(p=>p.title) };
  }
  // nearest by search
  const hits = search(KB.index, name, 5);
  const near = hits.map(h=>h.meta).filter(m=>KB.nodes.find(n=>n.id===m.id)?.type==='section')
                .slice(0,3);
  return { exact:null, near: near.map(m=>KB.nodes.find(n=>n.id===m.id)?.title).filter(Boolean) };
}

export function actionFindProcedure(name) {
  const exact = KB.nodes.find(n=>n.type==='procedure' && eq(n.title,name));
  if (exact) {
    const subs = KB.nodes.filter(n=>n.type==='sub' && n.parent===exact.id);
    return { exact, subs: subs.map(s=>s.title) };
  }
  const near = nearestTitles('procedure', name, 5);
  return { exact:null, near };
}

export function actionSummarizeSOP(name) {
  const target = findByAny(name);
  const images = findLinkedImages(target?.text || '');
  return { target, images };
}

export function actionWhoDoesWhat(name) {
  const target = findByAny(name);
  const rasci = findLinkedRASCI(target?.text || '');
  return { target, rasci };
}

function findByAny(name) {
  let ex = KB.nodes.find(n=>eq(n.title,name));
  if (ex) return ex;
  const hits = search(KB.index, name, 5);
  const first = hits[0]?.meta?.id;
  return KB.nodes.find(n=>n.id===first) || null;
}

function findLinkedImages(text) {
  if (!text) return [];
  const urls = Array.from(text.matchAll(/https?:\/\/\S+\.(png|jpg|jpeg|gif|svg)/gi)).map(m=>m[0]);
  return urls;
}

function findLinkedRASCI(text) {
  if (!text) return [];
  const urls = Array.from(text.matchAll(/https?:\/\/\S+rasci\S+\.(png|jpg|jpeg|gif|svg|pdf)/gi)).map(m=>m[0]);
  return urls;
}

function nearestTitles(type, name, k=5) {
  const pool = KB.nodes.filter(n=>n.type===type).map(n=>({title:n.title, id:n.id}));
  const scored = pool.map(p=>({s: scoreTitle(p.title,name), t:p.title})).sort((a,b)=>b.s-a.s);
  return scored.slice(0,k).map(x=>x.t);
}

function scoreTitle(a,b) {
  a=a.toLowerCase(); b=b.toLowerCase();
  const L = Math.max(a.length,b.length);
  let same = 0;
  for (let i=0;i<Math.min(a.length,b.length);i++) if (a[i]===b[i]) same++;
  return same / (L||1);
}

function eq(a,b){return a.trim().toLowerCase()===b.trim().toLowerCase();}
