import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

// ---------- Model provider (OpenAI or Anthropic) ----------
// Set PROVIDER in .env, or leave it empty and whichever key is present is used.
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const PROVIDER = (process.env.PROVIDER || (OPENAI_KEY ? 'openai' : 'anthropic')).toLowerCase();
const API_KEY = PROVIDER === 'openai' ? OPENAI_KEY : ANTHROPIC_KEY;
const MODEL =
  PROVIDER === 'openai'
    ? process.env.OPENAI_MODEL || 'gpt-4o'
    : process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const API_BASE = (
  PROVIDER === 'openai'
    ? process.env.OPENAI_BASE_URL || 'https://api.openai.com'
    : process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
).replace(/\/$/, '');

if (!API_KEY) {
  console.warn(
    `[hanasou] No API key for provider "${PROVIDER}". Add ${PROVIDER === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} to .env; the tutor will not respond until you do.`
  );
}

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe';
const canTranscribe = () => PROVIDER === 'openai' && Boolean(API_KEY);
const canSpeak = () => PROVIDER === 'openai' && Boolean(API_KEY);

// Warm, friendly female narration. Voices: shimmer, nova, coral, sage.
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'shimmer';
const TTS_VOICES = ['shimmer', 'nova', 'coral', 'sage', 'alloy'];
const TTS_STYLE =
  'Speak Japanese as a warm, friendly woman in her late twenties. Sound relaxed and encouraging, ' +
  'with clear articulation and a natural, unhurried pace, as if speaking to someone learning the language.';

async function synthesizeSpeech(text, voice, speed, model = TTS_MODEL) {
  const payload = {
    model,
    voice: TTS_VOICES.includes(voice) ? voice : TTS_VOICE,
    input: text,
    response_format: 'mp3',
    speed
  };
  // Only the newer speech model accepts a style instruction.
  if (model !== 'tts-1' && model !== 'tts-1-hd') payload.instructions = TTS_STYLE;
  const response = await fetch(`${API_BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const detail = await response.text();
    if (model !== 'tts-1') return synthesizeSpeech(text, voice, speed, 'tts-1');
    throw new Error(`API ${response.status}: ${detail.slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// Speech to text through OpenAI, which handles learner accents far better than
// the browser's built-in recognizer. Falls back to whisper-1 for older accounts.
async function transcribeAudio(buffer, contentType, ext, lang, model = TRANSCRIBE_MODEL) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }), `audio.${ext}`);
  form.append('model', model);
  if (lang === 'ja' || lang === 'en') form.append('language', lang);
  const response = await fetch(`${API_BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${API_KEY}` },
    body: form
  });
  if (!response.ok) {
    const detail = await response.text();
    if (model !== 'whisper-1') return transcribeAudio(buffer, contentType, ext, lang, 'whisper-1');
    throw new Error(`API ${response.status}: ${detail.slice(0, 300)}`);
  }
  const data = await response.json();
  return (data.text || '').trim();
}

// Sends the conversation to the chosen provider and returns the reply text.
async function askModel(system, messages, options = {}) {
  if (PROVIDER === 'openai') return askOpenAI(system, messages, 'max_completion_tokens', options);
  return askAnthropic(system, messages, options);
}

async function askAnthropic(system, messages, { model = MODEL, maxTokens = 2000 } = {}) {
  const response = await fetch(`${API_BASE}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages })
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

// OpenAI takes the system prompt as the first message. Older models want
// max_tokens and newer ones want max_completion_tokens, so try both.
async function askOpenAI(system, messages, tokenField = 'max_completion_tokens', { model = MODEL, maxTokens = 2000 } = {}) {
  const response = await fetch(`${API_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      [tokenField]: maxTokens
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    if (tokenField === 'max_completion_tokens' && /max_completion_tokens|max_tokens/i.test(detail)) {
      return askOpenAI(system, messages, 'max_tokens', { model, maxTokens });
    }
    throw new Error(`API ${response.status}: ${detail.slice(0, 300)}`);
  }
  const data = await response.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

// ---------- Learner profile (from the setup questionnaire) ----------
const CORRECTIONS = {
  none: 'none: never correct the learner.',
  natural: 'natural: fold the correct form into the character\'s reply without comment. Do not add feedback notes.',
  hints: 'hints: add one feedback note that points at the problem without giving the answer, so the learner can fix it.',
  direct: 'direct: add one feedback note with the correct form and a one-line reason.'
};
const REPLY_MODES = {
  english: 'English only: the learner tells you in English what their character does or says. Never ask them to produce Japanese, and never treat their English as a mistake.',
  mixed: 'Mostly English: the learner answers in English but likes to try a Japanese word or phrase now and then. Welcome the attempts, never require them.',
  japanese: 'Japanese as much as possible: the learner wants to answer in Japanese, in kana or romaji, and falls back to English when stuck. Let them lead; accept mixed replies.'
};
const SUPPORT = {
  partial: 'partial script: the learner wants a partial script to lean on at first, faded over time (see Opening).',
  on_request: 'suggestions on request: no scripts; the learner will send [HELP] when stuck.',
  none: 'no script: fully open conversation; the learner wants to be surprised. Still answer [HELP] if they send it.'
};

const str = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function cleanProfile(p = {}) {
  return {
    level: str(p.level, 60) || 'Beginner (N5)',
    background: str(p.background),
    setting: str(p.setting) || 'Everyday life in Japan',
    tone: str(p.tone, 60) || 'Relaxed',
    character: str(p.character),
    focus: str(p.focus) || 'Let it flow naturally',
    corrections: CORRECTIONS[p.corrections] ? p.corrections : 'natural',
    reply: REPLY_MODES[p.reply] ? p.reply : 'english',
    support: SUPPORT[p.support] ? p.support : 'on_request',
    display: str(p.display, 40)
  };
}

function buildSystemPrompt(profile, customInstructions) {
  return `You are "Sensei", a storyteller who teaches Japanese through immersive roleplay. You narrate scenes in English, seed Japanese into the narration, and play every character the learner meets. Learning happens through exposure, story context, and repetition, not drills.

## Learner profile (chosen in the setup questionnaire)
- Level: ${profile.level}
- Background: ${profile.background || 'not given'}
- Story setting: ${profile.setting}
- Mood: ${profile.tone}
- Their character: ${profile.character || 'your choice, fitting the setting; ask their name in the opening'}
- Learning focus: ${profile.focus}
- How they reply: ${REPLY_MODES[profile.reply]}
- Script support: ${SUPPORT[profile.support]}

## How the learner takes part
The learner tells you what their character does, says, or decides. Writing Japanese is optional and never required; they learn by reading, hearing, and understanding it first. Never ask them to produce a Japanese phrase they have not met in the story, and never quiz them. If they use Japanese, respond warmly in the story and keep going.

Whenever the learner says what their character says, even when they write it in English ("I thank her", "I ask for a coffee"), voice that line in Japanese first, as a dialogue line with their character's name, before any other character responds. Keep it close to what they meant and at their level. This way they always see how their own words sound in Japanese, with the script, romaji, and translation together.

## Writing a scene
Every story post has three parts, in this order:
1. **Narration in English**, two to four short paragraphs, present tense, with concrete sensory detail (sounds, light, smells, what people are doing). Seed Japanese words into the narration with this markup: {{romaji|Japanese|short English meaning}} — for example: The {{izakaya|居酒屋|Japanese pub}} is warm and lively. Use two to five of these per post, only for things that appear in the scene, and reuse words from earlier scenes so they recur naturally.
2. **Character speech**, one to three lines, each on its own line in exactly this format:
::Speaker|Japanese (kana and kanji)|Hepburn romaji|English translation
Example:
::Cafe owner|いらっしゃいませ。おひとりですか。|Irasshaimase. O-hitori desu ka?|Welcome. Just one person?
Always fill all four fields; the app decides whether to show the script, romaji, or English. Never put Japanese dialogue in the narration, and never put narration inside a dialogue line.
3. **A closing prompt**: one line asking what their character does, using their character's name. In the first two posts, add a short reminder in parentheses that they can answer in English.

Keep the Japanese at the learner's level: complete beginner or N5 = short greetings and simple polite sentences, with the same phrases recurring; N4 = simple connected sentences; N3 and up = natural everyday speech. Characters may speak a little above the learner's level as long as the translation carries the meaning.

## Playing the scene
- Characters are people, not prompts: they have their own moods and goals, and can surprise the learner (the kitchen is out of something, a cat jumps on the counter, a question the learner didn't expect).
- Register matters: shop staff and teachers use polite forms, friends and family use casual speech. If the learner's character is rude or too familiar, let the other character react as a real person would.
- Move the story forward with whatever the learner gives you. Don't stall to make them guess a phrase, and don't do their thinking for them.
- Their messages may come from speech recognition; ignore obvious recognition glitches.
- When a scene reaches a natural ending, close it and offer a choice of what happens next.
${profile.support === 'partial' ? '- The learner asked for a partial script: when there is something they might want to say in Japanese, offer two or three lines with blanks (___) for their own details, using the speaker name "You". Offer these for the first two scenes, then stop, so the support fades.' : '- Do not give the learner scripted lines unless they ask.'}

## Sensei mode
If the learner starts a message with "Sensei" or asks a question about the language, step out of the story: answer directly in English, plainly and specifically, with no narration and no character lines unless an example helps. Then offer to pick the story back up.

## Help requests
When the learner's message starts with [HELP]: don't advance the story. In one short English sentence, say what they could do next, then give two or three Japanese lines they could say, from simple to more natural, as dialogue lines with the speaker name "Option". They can use one, adapt it, or do something else entirely.

## Corrections: ${CORRECTIONS[profile.corrections]}
Corrections apply only to Japanese the learner actually tried. Never correct their English. Pick the single most important issue, and be honest rather than flattering.

## Language notes (required in every reply)
Your reply is incomplete without this block, so never leave it out, even in short scenes. End every reply with a notes block: two to four things worth learning from this scene. Cover the new words you seeded, one grammar point (why a particular ending, particle, or form was used), and a register or culture point when there is one. Don't repeat notes you already gave. Use exactly this format, with valid JSON:
<notes>[{"type":"vocab","term":"Irasshaimase","jp":"いらっしゃいませ","meaning":"Welcome (said by shop staff)","note":"You don't need to reply; a nod is enough."},{"type":"grammar","term":"desu ka","jp":"ですか","meaning":"turns a polite sentence into a question","note":"か at the end works like a spoken question mark."}]</notes>
"type" is vocab, grammar, culture, or feedback. "term" is the romaji as it appears in your post. "note" is one short sentence. Write the block as raw text on its own line, not inside a code fence, and put nothing after it.${
    customInstructions
      ? `\n\n## The learner's custom instructions\nFollow these unless they conflict with the rules above:\n${customInstructions}`
      : ''
  }`;
}

// Models don't always emit the notes block exactly as asked, so accept the
// tag, a fenced code block, or a bare JSON array at the end of the reply.
const NOTE_PATTERNS = [
  /<notes>([\s\S]*?)<\/notes>/i,
  /<notes>([\s\S]*)$/i,
  /```(?:json)?\s*(\[[\s\S]*?\])\s*```/,
  /(\[\s*\{[\s\S]*\}\s*\])\s*$/
];

function parseNotes(text) {
  for (const pattern of NOTE_PATTERNS) {
    const m = text.match(pattern);
    if (!m) continue;
    const notes = tolerantJson(m[1]);
    if (notes.length) return notes;
  }
  return [];
}

function tolerantJson(raw) {
  const cleaned = String(raw)
    .replace(/```(?:json)?/g, '')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(arr)
      ? arr.filter((n) => n && (n.term || n.meaning || n.note)).slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

// If the reply came back without notes, ask for them in a second, cheap call.
const NOTES_MODEL = process.env.OPENAI_NOTES_MODEL || 'gpt-4o-mini';
const NOTES_REQUEST = `Read this scene from a Japanese learning roleplay and list two to four things worth learning from it: words or phrases that appear in it, one grammar point (why a particular ending, particle, or form was used), and a register or culture point when there is one.
Answer with a JSON array only, no other text, in this shape:
[{"type":"vocab","term":"Irasshaimase","jp":"いらっしゃいませ","meaning":"Welcome (said by shop staff)","note":"You don't need to reply; a nod is enough."}]
"type" is vocab, grammar, or culture. "term" is the romaji. "note" is one short sentence.

Scene:
`;

async function requestNotes(reply) {
  try {
    const text = await askModel(
      'You write short language notes for Japanese learners. You answer with a JSON array and nothing else.',
      [{ role: 'user', content: `${NOTES_REQUEST}${reply.slice(0, 4000)}` }],
      { model: PROVIDER === 'openai' ? NOTES_MODEL : MODEL, maxTokens: 700 }
    );
    return tolerantJson(text);
  } catch (err) {
    console.error('[hanasou] notes fallback failed:', err.message);
    return [];
  }
}

function logExchange(entry) {
  const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  fs.appendFile(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', (err) => {
    if (err) console.error('[hanasou] log error:', err.message);
  });
}

function cleanMessages(messages) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const content = String(m.content ?? '').slice(0, 6000).trim();
    if (!content) continue;
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += `\n${content}`;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out.slice(-40);
}

const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 30) return res.status(429).json({ error: 'Too many messages. Wait a minute and try again.' });
  recent.push(now);
  hits.set(req.ip, recent);
  next();
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '300kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/capabilities', (_req, res) => {
  res.json({ transcribe: canTranscribe(), speak: canSpeak(), voices: TTS_VOICES, defaultVoice: TTS_VOICE, provider: PROVIDER });
});

app.post(
  '/api/transcribe',
  rateLimit,
  express.raw({ type: ['audio/*', 'video/*', 'application/octet-stream'], limit: '25mb' }),
  async (req, res) => {
    if (!canTranscribe()) {
      return res.status(400).json({ error: 'Voice transcription needs an OpenAI key on the server.' });
    }
    if (!req.body?.length) return res.status(400).json({ error: 'No audio was recorded.' });
    const type = (req.get('content-type') || 'audio/webm').split(';')[0];
    const ext = type.includes('mp4') || type.includes('m4a') ? 'mp4'
      : type.includes('ogg') ? 'ogg'
      : type.includes('wav') ? 'wav'
      : type.includes('mpeg') ? 'mp3'
      : 'webm';
    try {
      const text = await transcribeAudio(req.body, type, ext, String(req.query.lang || 'auto'));
      res.json({ text });
    } catch (err) {
      console.error('[hanasou] transcribe error:', err.message);
      res.status(502).json({ error: "That recording couldn't be transcribed. Try again or type instead." });
    }
  }
);

app.post('/api/speak', rateLimit, async (req, res) => {
  if (!canSpeak()) return res.status(400).json({ error: 'Spoken replies need an OpenAI key on the server.' });
  const text = String(req.body?.text || '').trim().slice(0, 1200);
  if (!text) return res.status(400).json({ error: 'Nothing to say.' });
  const speed = Math.min(1.4, Math.max(0.5, Number(req.body?.speed) || 1));
  try {
    const audio = await synthesizeSpeech(text, String(req.body?.voice || ''), speed);
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('cache-control', 'no-store');
    res.send(audio);
  } catch (err) {
    console.error('[hanasou] speech error:', err.message);
    res.status(502).json({ error: "That line couldn't be read aloud." });
  }
});

app.post('/api/chat', rateLimit, async (req, res) => {
  const body = req.body || {};
  const history = cleanMessages(body.messages);
  if (!API_KEY) {
    return res.status(500).json({
      error: `The server has no API key. Add ${PROVIDER === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} to .env and restart.`
    });
  }
  if (!history.length || history[history.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Send a message first.' });
  }

  const profile = cleanProfile(body.profile);
  const custom = String(body.customInstructions || '').trim().slice(0, 1500);
  const started = Date.now();

  try {
    let text = await askModel(buildSystemPrompt(profile, custom), history);
    let notes = parseNotes(text);
    if (!notes.length && !history[history.length - 1].content.startsWith('[HELP]')) {
      notes = await requestNotes(text);
      if (notes.length) text = `${text}\n\n<notes>${JSON.stringify(notes)}</notes>`;
    }
    const userMsg = history[history.length - 1].content;

    logExchange({
      sessionId: str(body.sessionId, 64),
      participantId: String(body.participantId || '').replace(/[^\w-]/g, '').slice(0, 64),
      kind: userMsg.startsWith('[START]') ? 'start' : userMsg.startsWith('[HELP]') ? 'help' : 'turn',
      user: userMsg,
      assistant: text,
      notes,
      profile,
      customInstructions: custom || undefined,
      display: body.display || undefined,
      provider: PROVIDER,
      model: MODEL,
      input: body.inputMode === 'voice' ? 'voice' : 'text',
      latencyMs: Date.now() - started
    });
    res.json({ text });
  } catch (err) {
    console.error('[hanasou] chat error:', err.message);
    res.status(502).json({ error: "Sensei couldn't reply. Try sending again." });
  }
});

// Download all conversation logs: /api/export?key=ADMIN_KEY
app.get('/api/export', (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden.' });
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="hanasou-logs.jsonl"');
  for (const f of fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.jsonl')).sort()) {
    res.write(fs.readFileSync(path.join(LOG_DIR, f)));
  }
  res.end();
});

app.listen(PORT, () => console.log(`[hanasou] Running at http://localhost:${PORT} (${PROVIDER}, ${MODEL})`));
