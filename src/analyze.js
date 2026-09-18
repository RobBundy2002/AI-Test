const STOP = new Set('about after again also and are because been before being between but can could did does for from had has have into its just more most not our out over said say she should some than that the their them there these they this those through very was were what when where which while who will with would you your'.split(' '));
const QUESTION_STARTS = ['What is one concrete response this sermon calls for?', 'Where do I need to trust God more deeply this week?', 'Who could I encourage with this message?'];

export function videoId(input) {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let id;
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
    else if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
    }
    return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}

export function normalizeTranscript(input) {
  if (typeof input === 'string') return input.trim().slice(0, 100000);
  if (!Array.isArray(input)) return '';
  return input.map(x => String(x.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ').slice(0, 100000);
}

export function extractiveNotes(transcript) {
  const clean = normalizeTranscript(transcript).replace(/\[[^\]]{1,30}\]/g, '');
  const sentences = (clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).map(s => s.trim()).filter(s => s.split(/\s+/).length >= 6);
  if (!sentences.length) return { summary: clean.slice(0, 450), takeaways: [], highlights: [], passages: [], outline: [], questions: QUESTION_STARTS, keywords: [], prayer: '' };
  const words = clean.toLowerCase().match(/[a-z']{4,}/g) || [];
  const freq = new Map();
  for (const word of words) if (!STOP.has(word)) freq.set(word, (freq.get(word) || 0) + 1);
  const ranked = sentences.map((sentence, index) => {
    const terms = [...new Set(sentence.toLowerCase().match(/[a-z']{4,}/g) || [])].filter(w => !STOP.has(w));
    const score = terms.reduce((sum, term) => sum + Math.log1p(freq.get(term) || 0), 0) / Math.sqrt(terms.length || 1) + (index < 3 ? 1 : 0);
    return { sentence, index, score };
  }).sort((a, b) => b.score - a.score);
  const chosen = ranked.slice(0, Math.min(3, ranked.length)).sort((a, b) => a.index - b.index).map(x => x.sentence);
  const passages = [...new Set((clean.match(/\b(?:[1-3] )?(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Isaiah|Jeremiah|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation)\s+\d+(?::\d+(?:-\d+)?)?\b/gi) || []).map(x => x.trim()))].slice(0, 8);
  const keywords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word]) => word);
  const outline = ranked.slice(0, 4).sort((a, b) => a.index - b.index).map((x, index) => ({ title: `Movement ${index + 1}`, point: x.sentence.slice(0, 220) }));
  return {
    summary: chosen.join(' ').slice(0, 1000),
    takeaways: ranked.slice(0, 5).sort((a, b) => a.index - b.index).map(x => x.sentence.slice(0, 300)),
    highlights: ranked.slice(0, 3).map(x => x.sentence.slice(0, 280)),
    passages,
    outline,
    questions: QUESTION_STARTS,
    keywords,
    prayer: keywords.length ? `Lord, help me receive this message with attention and respond with faithfulness, especially around ${keywords.slice(0, 3).join(', ')}.` : ''
  };
}

export function parseAiNotes(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return {
      summary: String(parsed.summary || fallback.summary).slice(0, 1400),
      takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways.slice(0, 6).map(x => String(x).slice(0, 350)) : fallback.takeaways,
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 4).map(x => String(x).slice(0, 350)) : fallback.highlights,
      passages: Array.isArray(parsed.passages) ? parsed.passages.slice(0, 8).map(x => String(x).slice(0, 80)) : fallback.passages,
      outline: Array.isArray(parsed.outline) ? parsed.outline.slice(0, 6).map((x, index) => typeof x === 'string' ? { title: `Point ${index + 1}`, point: x.slice(0, 260) } : { title: String(x?.title || `Point ${index + 1}`).slice(0, 80), point: String(x?.point || '').slice(0, 260) }).filter(x => x.point) : fallback.outline,
      questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 6).map(x => String(x).slice(0, 180)) : fallback.questions,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 10).map(x => String(x).slice(0, 40)) : fallback.keywords,
      prayer: String(parsed.prayer || fallback.prayer || '').slice(0, 600)
    };
  } catch { return fallback; }
}
