// vector.js — ultra-light local vector/search helpers (fallback when no embeddings model is loaded)
export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => t.length > 1);
}

export function tfidfIndex(chunks) {
  const docs = chunks.map(c => tokenize(c.text));
  const df = new Map();
  for (const doc of docs) {
    const seen = new Set();
    for (const tok of doc) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      df.set(tok, (df.get(tok) || 0) + 1);
    }
  }
  const N = docs.length || 1;
  const index = [];
  for (let i = 0; i < docs.length; i++) {
    const counts = new Map();
    for (const tok of docs[i]) counts.set(tok, (counts.get(tok)||0) + 1);
    const vec = new Map();
    for (const [tok, c] of counts) {
      const idf = Math.log( (N+1) / ((df.get(tok) || 0) + 1) ) + 1;
      vec.set(tok, (c / docs[i].length) * idf);
    }
    index.push({vec, meta: chunks[i]});
  }
  return index;
}

export function cosSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const va = a.get(k) || 0, vb = b.get(k) || 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

export function search(index, query, k=8) {
  const qTokens = tokenize(query);
  const qCounts = new Map();
  for (const t of qTokens) qCounts.set(t, (qCounts.get(t)||0) + 1);
  const qVec = qCounts; // tf only
  const scored = index.map(e => ({s: cosSim(e.vec, qVec), meta: e.meta}));
  scored.sort((a,b) => b.s - a.s);
  return scored.slice(0,k);
}
