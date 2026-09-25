const $ = (id) => document.getElementById(id);
const els = {
  bg: $('bg'), home: $('home'), setup: $('setup'), setupForm: $('setupForm'), setupFields: $('setupFields'),
  setupBack: $('setupBack'), chat: $('chat'), messages: $('messages'), dock: $('dock'),
  input: $('input'), send: $('sendBtn'), mic: $('micBtn'), help: $('helpBtn'), status: $('status'),
  start: $('startBtn'), resume: $('resumeBtn'), newChat: $('newChat'),
  notesToggle: $('notesToggle'), notesCount: $('notesCount'), notesPanel: $('notesPanel'),
  notesList: $('notesList'), notesEmpty: $('notesEmpty'), notesClose: $('notesClose'),
  settingsBtn: $('settingsBtn'), settings: $('settings'),
  showJp: $('showJp'), showRo: $('showRo'), showEn: $('showEn'), changeSetup: $('changeSetup'),
  tts: $('ttsToggle'), voice: $('voiceSelect'), rate: $('rateInput'), micLang: $('micLang'), bgToggle: $('bgToggle'),
  dialog: $('instructionsDialog'), instructions: $('instructionsText'), openInstructions: $('openInstructions')
};

const CHAT_KEY = 'hanasou.chat';
const SETTINGS_KEY = 'hanasou.settings';
const PROFILE_KEY = 'hanasou.profile';
const participantId = new URLSearchParams(location.search).get('pid') || '';
const START_MESSAGE = '[START] Begin the story.';
const HELP_MESSAGE = "[HELP] I'm not sure what to say next.";

// ---------- Setup questionnaire ----------
// Each question: key, label, options as [value, label]; "other" adds a free-text choice.
const SETUP = [
  {
    section: 'About you',
    questions: [
      { key: 'level', label: 'How much Japanese do you know?', options: [
        ['Complete beginner', 'Complete beginner'],
        ['Beginner (N5)', 'Beginner (N5): greetings, simple phrases'],
        ['Elementary (N4)', 'Elementary (N4): simple sentences, the te-form'],
        ['Intermediate (N3 and up)', 'Intermediate (N3+): everyday conversation']
      ], value: 'Beginner (N5)' },
      { key: 'background', label: 'How have you learned so far?', text: 'Classes, anime, Duolingo, self-study… (optional)' }
    ]
  },
  {
    section: 'Your story',
    questions: [
      { key: 'setting', label: 'Where should the story happen?', options: [
        ['Campus life at a Japanese university', 'Campus life'],
        ['A café or izakaya', 'Café or izakaya'],
        ['Traveling around Japan', 'Traveling in Japan'],
        ['Starting a new job in Japan', 'Starting a new job'],
        ["Visiting a friend's family home", "Visiting a friend's home"]
      ], other: 'Something else…', value: 'A café or izakaya' },
      { key: 'tone', label: 'What mood?', options: [
        ['Relaxed', 'Relaxed'], ['Funny', 'Funny'], ['Dramatic', 'Dramatic'], ['Mysterious', 'Mysterious']
      ], value: 'Relaxed' },
      { key: 'character', label: 'Who would you like to play?', text: 'An exchange student, a traveler, a new employee… (optional)' }
    ]
  },
  {
    section: 'How you learn',
    questions: [
      { key: 'focus', label: 'Anything to focus on?', options: [
        ['Everyday interactions (ordering, transit, small talk)', 'Everyday interactions'],
        ['Polite vs. casual speech', 'Polite vs. casual speech'],
        ['Let it flow naturally', 'Let it flow naturally']
      ], other: 'A specific grammar point…', value: 'Let it flow naturally' },
      { key: 'reply', label: 'How do you want to reply?', options: [
        ['english', 'In English, I just say what I do'],
        ['mixed', 'Mostly English, with Japanese when I feel like it'],
        ['japanese', 'In Japanese as much as I can']
      ], value: 'english' },
      { key: 'display', label: 'How should Japanese be shown?', options: [
        ['jp-ro-en', 'Japanese script + romaji + English'],
        ['ro-en', 'Romaji + English'],
        ['jp-en', 'Japanese script + English']
      ], value: 'jp-ro-en' },
      { key: 'corrections', label: 'How should mistakes be handled?', options: [
        ['none', "Don't correct me"],
        ['natural', 'Just say it correctly back to me'],
        ['hints', 'Give me a hint so I can fix it'],
        ['direct', 'Show me the correct form']
      ], value: 'natural' },
      { key: 'support', label: 'How much help with what to say?', options: [
        ['partial', 'A partial script to start'],
        ['on_request', 'Suggestions when I ask'],
        ['none', 'No script, surprise me']
      ], value: 'on_request' }
    ]
  }
];

const DISPLAY_PRESETS = {
  'ro-en': { jp: false, ro: true, en: true },
  'jp-ro-en': { jp: true, ro: true, en: true },
  'jp-en': { jp: true, ro: false, en: true }
};

const NOTE_LABELS = { vocab: 'Word or phrase', grammar: 'Grammar', culture: 'Culture', feedback: 'Feedback' };

// ---------- Storage ----------
const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};

const storedSettings = load(SETTINGS_KEY, {});
// Bumped when a default changes, so saved preferences pick it up once.
const SETTINGS_VERSION = 2;
const settings = {
  tts: false, voiceURI: '', rate: 0.9, micLang: 'auto', showBg: true, customInstructions: '',
  ...storedSettings,
  show: { jp: true, ro: true, en: true, ...(storedSettings.show || {}) }
};
if (storedSettings.version !== SETTINGS_VERSION) {
  settings.tts = false;
  settings.version = SETTINGS_VERSION;
  save(SETTINGS_KEY, settings);
}
let profile = load(PROFILE_KEY, null);
let chat = { sessionId: null, messages: [] };
let notes = [];
let busy = false;
let lastInputMode = 'text';

// ---------- Text helpers ----------
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function inline(s) {
  return s
    .replace(/\{\{([^{}|]+)\|([^{}|]+)(?:\|([^{}|]*))?\}\}/g, (_, ro, jp, meaning) =>
      `<span class="term vocab" tabindex="0" data-jp="${jp.trim()}" data-tip="${(meaning || '').trim() || jp.trim()}"><span class="t-jp" lang="ja">${jp.trim()}</span><span class="t-ro">${ro.trim()}</span></span>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>');
}

// Small Markdown renderer for Sensei's English narration (input is escaped first).
function renderMarkdown(lines) {
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
  const flushList = () => {
    if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = escapeHtml(raw.trim());
    let m;
    if (!line) { flushPara(); flushList(); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if ((m = line.match(/^#{1,6}\s+(.*)$/))) { flushPara(); flushList(); out.push(`<h3>${inline(m[1])}</h3>`); continue; }
    if ((m = line.match(/^\d+[.)]\s+(.*)$/)) || (m = line.match(/^[-*•]\s+(.*)$/))) {
      const type = /^\d/.test(line) ? 'ol' : 'ul';
      flushPara();
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join('');
}

// Split a raw reply into the visible body and the notes block. Models format
// the block loosely, so accept the tag, a fenced block, or a bare JSON array.
const NOTE_PATTERNS = [
  /<notes>[\s\S]*?(?:<\/notes>|$)/i,
  /```(?:json)?\s*\[[\s\S]*?\]\s*```/,
  /\[\s*\{[\s\S]*\}\s*\]\s*$/
];

function tolerantJson(raw) {
  const cleaned = String(raw)
    .replace(/<\/?notes>/gi, '')
    .replace(/```(?:json)?/g, '')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(arr) ? arr.filter((n) => n && (n.term || n.meaning || n.note)).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function parseReply(raw) {
  let body = raw;
  let notesOut = [];
  for (const pattern of NOTE_PATTERNS) {
    const m = body.match(pattern);
    if (!m) continue;
    const parsed = tolerantJson(m[0]);
    if (!parsed.length) continue;
    notesOut = parsed;
    body = body.replace(m[0], '');
    break;
  }
  return { body: body.trim(), notes: notesOut };
}

function parseDialogue(line) {
  const parts = line.replace(/^::/, '').split('|').map((p) => p.trim());
  if (parts.length < 3) return null;
  const [speaker, jp, ro, ...rest] = parts;
  return { speaker, jp, ro, en: rest.join(' | ') };
}

function renderBody(body) {
  const lines = body.split('\n');
  const html = [];
  const dialogue = [];
  let buffer = [];
  const flush = () => { if (buffer.length) html.push(renderMarkdown(buffer)); buffer = []; };
  for (const line of lines) {
    const d = line.trim().startsWith('::') ? parseDialogue(line.trim()) : null;
    if (!d) { buffer.push(line); continue; }
    flush();
    const kind = /^(you|option)$/i.test(d.speaker) ? ' learner-line' : '';
    const idx = dialogue.push(d) - 1;
    html.push(`
      <div class="line${kind}" data-idx="${idx}">
        <div class="line-head">
          <span class="speaker">${escapeHtml(d.speaker)}</span>
          ${d.jp && !d.jp.includes('_') ? `<button class="say" type="button" aria-label="Play this line">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4Z"/></svg></button>` : ''}
        </div>
        <p class="jp" lang="ja">${escapeHtml(d.jp)}</p>
        <p class="ro">${escapeHtml(d.ro)}</p>
        <p class="en">${escapeHtml(d.en)}</p>
      </div>`);
  }
  flush();
  return { html: html.join(''), dialogue };
}

// Wrap the first occurrence of `needle` inside `root`'s text with an annotated span.
function annotate(root, needle, tip, noteId) {
  if (!needle || needle.length < 2) return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const lower = needle.toLowerCase();
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement.closest('.term, .speaker, button')) continue;
    const i = node.nodeValue.toLowerCase().indexOf(lower);
    if (i === -1) continue;
    const range = document.createRange();
    range.setStart(node, i);
    range.setEnd(node, i + needle.length);
    const span = document.createElement('span');
    span.className = 'term';
    span.tabIndex = 0;
    span.dataset.tip = tip;
    span.dataset.note = noteId;
    range.surroundContents(span);
    return true;
  }
  return false;
}

// ---------- Messages ----------
function addUser(text) {
  const li = document.createElement('li');
  li.className = 'msg user';
  li.innerHTML = '<div class="bubble"></div>';
  li.querySelector('.bubble').textContent = text;
  els.messages.appendChild(li);
  li.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

function addHelpMarker() {
  const li = document.createElement('li');
  li.className = 'msg marker';
  li.textContent = 'You asked for help';
  els.messages.appendChild(li);
}

function addAssistant(raw, { speakNow = false } = {}) {
  const { body, notes: newNotes } = parseReply(raw);
  const { html, dialogue } = renderBody(body);
  const li = document.createElement('li');
  li.className = 'msg assistant';
  li.innerHTML = `
    <div class="who"><span class="avatar" aria-hidden="true">先</span> Sensei</div>
    <div class="glass bubble md">${html}</div>`;
  const bubble = li.querySelector('.bubble');

  bubble.querySelectorAll('.line').forEach((el) => {
    const d = dialogue[Number(el.dataset.idx)];
    el.querySelector('.say')?.addEventListener('click', () => speak(d.jp));
  });

  newNotes.forEach((n) => {
    const id = addNote(n);
    const tip = [n.meaning, n.note].filter(Boolean).join(' · ');
    if (!annotate(bubble, n.term, tip, id)) annotate(bubble, n.jp, tip, id);
  });

  els.messages.appendChild(li);
  li.scrollIntoView({ block: 'start', behavior: 'smooth' });

  if (speakNow && settings.tts) {
    const spoken = dialogue.filter((d) => d.jp && !/^(you|option)$/i.test(d.speaker)).map((d) => d.jp).join('。');
    speak(spoken);
  }
}

function showTyping(on) {
  const existing = document.querySelector('.msg.typing');
  if (!on) return existing?.remove();
  if (existing) return;
  const li = document.createElement('li');
  li.className = 'msg assistant typing';
  li.innerHTML = '<div class="glass bubble"><span class="dots" aria-label="Sensei is typing"><i></i><i></i><i></i></span></div>';
  els.messages.appendChild(li);
  li.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

function renderHistory() {
  els.messages.innerHTML = '';
  notes = [];
  els.notesList.innerHTML = '';
  updateNotesCount();
  for (const m of chat.messages) {
    if (m.role === 'assistant') addAssistant(m.content);
    else if (m.content.startsWith('[START]')) continue;
    else if (m.content.startsWith('[HELP]')) addHelpMarker();
    else addUser(m.content);
  }
}

// ---------- Notes tracker ----------
function addNote(n) {
  const id = `note-${notes.length}`;
  notes.push({ ...n, id });
  const type = NOTE_LABELS[n.type] ? n.type : 'vocab';
  const li = document.createElement('li');
  li.className = `note n-${type}`;
  li.id = id;
  li.innerHTML = `
    <span class="tag">${NOTE_LABELS[type]}</span>
    <p class="note-term">${n.term ? `<strong>${escapeHtml(n.term)}</strong>` : ''} ${n.jp ? `<span lang="ja">${escapeHtml(n.jp)}</span>` : ''}</p>
    ${n.meaning ? `<p>${escapeHtml(n.meaning)}</p>` : ''}
    ${n.note ? `<p class="note-extra">${escapeHtml(n.note)}</p>` : ''}`;
  els.notesList.prepend(li);
  updateNotesCount();
  return id;
}

function updateNotesCount() {
  els.notesCount.textContent = notes.length;
  els.notesEmpty.hidden = notes.length > 0;
}

const wideScreen = () => matchMedia('(min-width: 80rem)').matches;

function setNotesOpen(open) {
  els.notesPanel.hidden = !open;
  els.notesToggle.setAttribute('aria-expanded', String(open));
}

function focusNote(id) {
  if (!wideScreen()) setNotesOpen(true);
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

els.messages.addEventListener('click', (e) => {
  const term = e.target.closest('.term');
  if (!term) return;
  if (term.dataset.jp) speak(term.dataset.jp);
  else focusNote(term.dataset.note);
});
els.messages.addEventListener('keydown', (e) => {
  const term = e.target.closest('.term');
  if (term && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    if (term.dataset.jp) speak(term.dataset.jp);
    else focusNote(term.dataset.note);
  }
});
els.notesToggle.addEventListener('click', () => setNotesOpen(els.notesPanel.hidden));
els.notesClose.addEventListener('click', () => setNotesOpen(false));

// ---------- Views ----------
function setView(view) {
  els.home.hidden = view !== 'home';
  els.setup.hidden = view !== 'setup';
  els.chat.hidden = view !== 'chat';
  els.dock.hidden = view === 'setup';
  els.newChat.hidden = view !== 'chat';
  els.notesToggle.hidden = view !== 'chat';
  els.help.hidden = view !== 'chat';
  els.resume.hidden = !(view === 'home' && load(CHAT_KEY, null)?.messages?.length);
  setNotesOpen(view === 'chat' && wideScreen());
  document.body.dataset.view = view;
}

function renderSetup() {
  const current = profile || {};
  els.setupFields.innerHTML = SETUP.map((sec) => `
    <fieldset class="setup-section">
      <legend>${sec.section}</legend>
      ${sec.questions.map((q) => {
        if (q.text) {
          return `<label class="q">
            <span class="q-label">${q.label}</span>
            <input type="text" name="${q.key}" maxlength="200" placeholder="${escapeHtml(q.text)}" value="${escapeHtml(current[q.key] || '')}">
          </label>`;
        }
        const selected = current[q.key] ?? q.value;
        const known = q.options.some(([v]) => v === selected);
        return `<div class="q" role="radiogroup" aria-label="${escapeHtml(q.label)}">
          <span class="q-label">${q.label}</span>
          <div class="choices">
            ${q.options.map(([v, label]) => `
              <label class="choice"><input type="radio" name="${q.key}" value="${escapeHtml(v)}" ${v === selected ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`).join('')}
            ${q.other ? `<label class="choice"><input type="radio" name="${q.key}" value="__other" ${!known && selected ? 'checked' : ''}><span>Other</span></label>` : ''}
          </div>
          ${q.other ? `<input type="text" class="other" name="${q.key}__other" maxlength="200" placeholder="${escapeHtml(q.other)}" value="${!known ? escapeHtml(selected || '') : ''}" ${!known && selected ? '' : 'hidden'}>` : ''}
        </div>`;
      }).join('')}
    </fieldset>`).join('');

  els.setupFields.querySelectorAll('input[type="radio"]').forEach((r) =>
    r.addEventListener('change', () => {
      const other = els.setupFields.querySelector(`[name="${r.name}__other"]`);
      if (!other) return;
      other.hidden = r.value !== '__other';
      if (!other.hidden) other.focus();
    })
  );
}

els.setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(els.setupForm);
  const next = {};
  for (const sec of SETUP) {
    for (const q of sec.questions) {
      let v = (data.get(q.key) || '').toString().trim();
      if (v === '__other') v = (data.get(`${q.key}__other`) || '').toString().trim() || q.value || '';
      next[q.key] = v;
    }
  }
  profile = next;
  save(PROFILE_KEY, profile);
  settings.show = { ...(DISPLAY_PRESETS[profile.display] || DISPLAY_PRESETS['jp-ro-en']) };
  settings.micLang = { english: 'en', japanese: 'ja' }[profile.reply] || 'auto';
  save(SETTINGS_KEY, settings);
  applySettings();
  startNewStory();
});

els.setupBack.addEventListener('click', () => setView(chat.messages.length ? 'chat' : 'home'));

function startNewStory() {
  stopSpeaking();
  chat = { sessionId: crypto.randomUUID(), messages: [] };
  save(CHAT_KEY, chat);
  renderHistory();
  setView('chat');
  send(START_MESSAGE, { hidden: true });
}

// ---------- Sending ----------
async function send(text, { hidden = false } = {}) {
  text = text.trim();
  if (!text || busy) return;
  if (!chat.sessionId) chat.sessionId = crypto.randomUUID();
  stopSpeaking();
  chat.messages.push({ role: 'user', content: text });
  if (text.startsWith('[HELP]')) addHelpMarker();
  else if (!hidden) addUser(text);
  save(CHAT_KEY, chat);
  if (!hidden) {
    els.input.value = '';
    autosize();
  }

  busy = true;
  els.send.disabled = true;
  els.help.disabled = true;
  setStatus('');
  showTyping(true);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: chat.messages,
        profile,
        customInstructions: settings.customInstructions,
        display: settings.show,
        sessionId: chat.sessionId,
        participantId,
        inputMode: lastInputMode
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    showTyping(false);
    chat.messages.push({ role: 'assistant', content: data.text });
    addAssistant(data.text, { speakNow: true });
    save(CHAT_KEY, chat);
  } catch (err) {
    showTyping(false);
    chat.messages.pop();
    if (!hidden) {
      els.messages.lastElementChild?.remove();
      if (!text.startsWith('[')) els.input.value = text;
    }
    setStatus(err.message);
    if (hidden) setStatus(`${err.message} Use "New story" to try again.`);
  } finally {
    busy = false;
    els.send.disabled = false;
    els.help.disabled = false;
    lastInputMode = 'text';
  }
}

function setStatus(text) {
  els.status.textContent = text;
}

// ---------- Speech output ----------
// Preferred path: OpenAI's speech model, a warm female voice. Fallback: the
// browser's own voices, choosing a Japanese female one where possible.
let serverSpeak = false;
let serverVoices = [];
let defaultServerVoice = 'shimmer';
let audio = null;

const VOICE_LABELS = {
  shimmer: 'Shimmer: warm and friendly',
  nova: 'Nova: bright and upbeat',
  coral: 'Coral: gentle and calm',
  sage: 'Sage: steady and clear',
  alloy: 'Alloy: neutral'
};
// Japanese voices that are female on macOS, Windows, and Chrome.
const FEMALE_HINTS = ['kyoko', 'o-ren', 'nanami', 'haruka', 'ayumi', 'sayaka', 'mizuki', 'google 日本語', 'female'];

function japaneseVoices() {
  if (!('speechSynthesis' in window)) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('ja'));
}

function preferredBrowserVoice() {
  const voices = japaneseVoices();
  const chosen = voices.find((v) => v.voiceURI === settings.voiceURI);
  if (chosen) return chosen;
  const female = voices.find((v) => FEMALE_HINTS.some((h) => v.name.toLowerCase().includes(h)));
  return female || voices[0];
}

function fillVoices() {
  if (serverSpeak) {
    els.voice.innerHTML = serverVoices
      .map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(VOICE_LABELS[v] || v)}</option>`)
      .join('');
    els.voice.value = serverVoices.includes(settings.voiceURI) ? settings.voiceURI : defaultServerVoice;
    return;
  }
  const voices = japaneseVoices();
  els.voice.innerHTML = voices.length
    ? voices.map((v) => `<option value="${escapeHtml(v.voiceURI)}">${escapeHtml(v.name)}</option>`).join('')
    : '<option value="">Default Japanese voice</option>';
  const preferred = preferredBrowserVoice();
  if (preferred) els.voice.value = preferred.voiceURI;
}

function speakInBrowser(text) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  u.rate = settings.rate;
  u.pitch = 1.05;
  const voice = preferredBrowserVoice();
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

async function speak(text) {
  if (!text) return;
  stopSpeaking();
  if (!serverSpeak) return speakInBrowser(text);
  try {
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: serverVoices.includes(settings.voiceURI) ? settings.voiceURI : defaultServerVoice,
        speed: settings.rate
      })
    });
    if (!res.ok) throw new Error('speech request failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    audio = new Audio(url);
    audio.onended = audio.onerror = () => URL.revokeObjectURL(url);
    await audio.play();
  } catch {
    speakInBrowser(text);
  }
}

function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (audio) {
    audio.pause();
    audio = null;
  }
}

// ---------- Speech input ----------
// Preferred path: record audio and transcribe it on the server (far more
// accurate for learner speech). Fallback: the browser's own recognizer.
let serverTranscribe = false;
let recorder = null;
let micStream = null;
let chunks = [];
let listening = false;

const SPEECH_LANG = { ja: 'ja-JP', en: 'en-US', auto: 'ja-JP' };

fetch('/api/capabilities')
  .then((r) => r.json())
  .then((c) => {
    serverTranscribe = Boolean(c.transcribe);
    serverSpeak = Boolean(c.speak);
    serverVoices = Array.isArray(c.voices) ? c.voices : [];
    defaultServerVoice = c.defaultVoice || defaultServerVoice;
    if (serverSpeak && !serverVoices.includes(settings.voiceURI)) settings.voiceURI = defaultServerVoice;
    fillVoices();
  })
  .catch(() => {});

function micOn(on) {
  listening = on;
  els.mic.classList.toggle('on', on);
  els.mic.setAttribute('aria-pressed', String(on));
}

function appendTranscript(text) {
  if (!text) return;
  els.input.value = els.input.value.trim() ? `${els.input.value.trim()} ${text}` : text;
  autosize();
  lastInputMode = 'voice';
  setStatus('Check the text, then send.');
}

async function startRecording() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(
    (t) => window.MediaRecorder?.isTypeSupported(t)
  );
  recorder = new MediaRecorder(micStream, mime ? { mimeType: mime } : {});
  chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = sendRecording;
  recorder.start();
  micOn(true);
  setStatus('Listening… tap the microphone again when you finish.');
}

async function sendRecording() {
  micStream?.getTracks().forEach((t) => t.stop());
  micOn(false);
  const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
  chunks = [];
  if (blob.size < 1200) return setStatus("That was very short. Tap the microphone and speak again.");
  setStatus('Transcribing…');
  try {
    const res = await fetch(`/api/transcribe?lang=${encodeURIComponent(settings.micLang)}`, {
      method: 'POST',
      headers: { 'content-type': blob.type },
      body: blob
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Transcription failed.');
    if (!data.text) return setStatus("I couldn't make that out. Try again, a little closer to the microphone.");
    appendTranscript(data.text);
  } catch (err) {
    setStatus(err.message);
  }
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
if (Recognition) {
  recognizer = new Recognition();
  recognizer.interimResults = true;
  recognizer.continuous = false;
  let base = '';
  recognizer.onstart = () => { base = els.input.value ? `${els.input.value.trim()} ` : ''; };
  recognizer.onresult = (e) => {
    let text = '';
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
    els.input.value = base + text;
    autosize();
  };
  recognizer.onerror = (e) => {
    const msg = {
      'not-allowed': 'Microphone access is blocked. Allow it in your browser settings.',
      'no-speech': "I didn't hear anything. Tap the microphone and try again."
    }[e.error];
    setStatus(msg || `Speech input stopped (${e.error}).`);
  };
  recognizer.onend = () => {
    micOn(false);
    if (els.input.value.trim()) {
      lastInputMode = 'voice';
      setStatus('Check the text, then send.');
    }
  };
}

if (!Recognition && !window.MediaRecorder) els.mic.hidden = true;

els.mic.addEventListener('click', async () => {
  if (listening) {
    if (serverTranscribe && recorder) recorder.stop();
    else recognizer?.stop();
    return;
  }
  stopSpeaking();
  if (serverTranscribe && window.MediaRecorder && navigator.mediaDevices?.getUserMedia) {
    try {
      await startRecording();
    } catch (err) {
      setStatus(
        err.name === 'NotAllowedError'
          ? 'Microphone access is blocked. Allow it in your browser settings.'
          : `Could not start recording (${err.name || 'error'}).`
      );
      micOn(false);
    }
    return;
  }
  if (!recognizer) return setStatus('This browser cannot record speech. Type your reply instead.');
  recognizer.lang = SPEECH_LANG[settings.micLang] || 'ja-JP';
  try {
    recognizer.start();
    micOn(true);
    setStatus('Listening…');
  } catch { /* already started */ }
});

// ---------- Settings ----------
function applySettings() {
  els.bg.hidden = !settings.showBg;
  document.body.classList.toggle('no-bg', !settings.showBg);
  document.body.classList.toggle('hide-jp', !settings.show.jp);
  document.body.classList.toggle('hide-ro', !settings.show.ro);
  document.body.classList.toggle('hide-en', !settings.show.en);
  els.showJp.checked = settings.show.jp;
  els.showRo.checked = settings.show.ro;
  els.showEn.checked = settings.show.en;
  els.tts.checked = settings.tts;
  els.rate.value = settings.rate;
  els.micLang.value = settings.micLang;
  els.bgToggle.checked = settings.showBg;
}

function toggleSettings(open = els.settings.hidden) {
  els.settings.hidden = !open;
  els.settingsBtn.setAttribute('aria-expanded', String(open));
}

els.settingsBtn.addEventListener('click', () => toggleSettings());
document.addEventListener('click', (e) => {
  if (!els.settings.hidden && !e.target.closest('.settings-wrap')) toggleSettings(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!els.settings.hidden) toggleSettings(false);
  else if (!els.notesPanel.hidden && !wideScreen()) setNotesOpen(false);
});

const bind = (el, apply) =>
  el.addEventListener('change', () => {
    apply(el);
    save(SETTINGS_KEY, settings);
    applySettings();
  });
bind(els.showJp, (el) => (settings.show.jp = el.checked));
bind(els.showRo, (el) => (settings.show.ro = el.checked));
bind(els.showEn, (el) => (settings.show.en = el.checked));
bind(els.tts, (el) => (settings.tts = el.checked));
bind(els.voice, (el) => (settings.voiceURI = el.value));
bind(els.rate, (el) => (settings.rate = Number(el.value)));
bind(els.micLang, (el) => (settings.micLang = el.value));
bind(els.bgToggle, (el) => (settings.showBg = el.checked));

els.changeSetup.addEventListener('click', () => {
  toggleSettings(false);
  renderSetup();
  setView('setup');
});

els.openInstructions.addEventListener('click', () => {
  toggleSettings(false);
  els.instructions.value = settings.customInstructions;
  els.dialog.showModal();
});
els.dialog.addEventListener('close', () => {
  if (els.dialog.returnValue === 'save') {
    settings.customInstructions = els.instructions.value.trim();
    save(SETTINGS_KEY, settings);
    setStatus(settings.customInstructions ? 'Custom instructions saved.' : 'Custom instructions cleared.');
  }
});

// ---------- Composer ----------
function autosize() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 180)}px`;
}
els.input.addEventListener('input', autosize);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (els.chat.hidden) return;
    send(els.input.value);
  }
});
els.send.addEventListener('click', () => {
  if (els.chat.hidden) {
    if (!els.input.value.trim()) return;
    renderSetup();
    setView('setup');
    return;
  }
  send(els.input.value);
});
els.help.addEventListener('click', () => send(HELP_MESSAGE));

els.start.addEventListener('click', () => {
  renderSetup();
  setView('setup');
});

els.resume.addEventListener('click', () => {
  chat = load(CHAT_KEY, { sessionId: null, messages: [] });
  setView('chat');
  renderHistory();
});

els.newChat.addEventListener('click', () => {
  if (!profile) {
    renderSetup();
    setView('setup');
    return;
  }
  startNewStory();
});

// ---------- Boot ----------
applySettings();
fillVoices();
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = fillVoices;
setView('home');
