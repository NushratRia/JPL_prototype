# Hanasou: Japanese through roleplay (formative study prototype)

A basic chat prototype for learning Japanese through roleplay. "Sensei" asks about the learner's level, preferred situation, and correction style, then sets scenes and plays the characters. Learners can type or speak, and replies can be read aloud.

It's intentionally minimal, meant for a formative study of how learners experience an AI roleplay tutor.

## Features

- **Comprehension first.** Sensei narrates each scene in English with Japanese seeded into it, and characters speak Japanese with romaji and a translation underneath. Learners reply in English about what their character does; producing Japanese is optional at every point.
- **Setup questionnaire.** Before each story, learners choose their level, background, setting, mood, character, learning focus, how they want to reply (English, mixed, or Japanese), how Japanese is shown, how mistakes are handled, and how much script support they want. Sensei builds the story from these choices and lets learners pick the order of activities within each scene.
- **Dialogue lines** show Japanese script, romaji, and English, each of which the learner can switch on or off (romaji + English by default). Every line has a play button, and replies can be read aloud automatically.
- **Notes tracker.** The language notes for each scene (words, grammar, register and culture, feedback) collect in a side panel. Japanese words in the narration are underlined: hover to see the meaning, click to hear it.
- **Sensei mode.** Starting a message with "Sensei" pauses the story and gets a direct explanation, then play resumes.
- **Script support.** "A partial script to start" gives fill-in-the-blank lines that fade after the first activities; "Help me reply" offers two or three options on demand; "No script" keeps the conversation fully open.
- **Speech input.** With an OpenAI key, recordings are transcribed by OpenAI's speech model, which handles learner accents far better than the browser's built-in recognizer. Tap the microphone to start, tap again to stop, then check the text before sending. Language can be set to Japanese, English, or automatic. Without an OpenAI key, it falls back to the browser recognizer.
- Custom instructions, a background toggle, and "Return to your last story"
- Server-side logging of every exchange for the research team, including the learner's setup choices and each notes list

## Run it locally

Requires Node.js 18.17+ and an API key from either OpenAI or Anthropic.

```bash
npm install
cp .env.example .env   # add your key (see below)
npm start
```

**With an OpenAI key** (the default), set these in `.env`:

```
PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
```

Speech transcription uses `gpt-4o-transcribe`, with `whisper-1` as a fallback for older accounts. Change it with `OPENAI_TRANSCRIBE_MODEL` if you like.

`gpt-4o` is a good starting point. Plain `gpt-4`, `gpt-4-turbo`, `gpt-4.1`, and `gpt-5` also work if your account has them; newer models generally handle Japanese and the dialogue format better.

**With an Anthropic key**, set these instead:

```
PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5
```

Nothing else changes: the learner interface, the setup questionnaire, the notes tracker, and the logs are the same either way, and each log line records which provider and model produced the reply, so you can compare them.

Open http://localhost:3000 in Chrome, Edge, or Safari (Firefox has no speech recognition). Add `?pid=P01` to the URL to tag a participant's conversations, e.g. `http://localhost:3000/?pid=P01`.

## Keeping it isolated from your other projects

Node installs dependencies into this project's own `node_modules` folder, so nothing is added system-wide and other projects are unaffected. There is no virtual environment to create. Two optional extras pin things further:

**Pin the Node version with nvm.** `.nvmrc` asks for Node 20. With [nvm](https://github.com/nvm-sh/nvm) installed:

```bash
nvm install    # first time only
nvm use        # switches this shell to Node 20
npm install
npm start
```

**Or run it in Docker**, with nothing installed on your machine but Docker itself:

```bash
cp .env.example .env   # add your API key
docker compose up --build
```

The app runs at http://localhost:3000, and logs are written to the `logs/` folder on your machine. Stop it with Ctrl+C, or `docker compose down`.

## Research logs

Each exchange is appended to `logs/YYYY-MM-DD.jsonl` with the timestamp, session ID, participant ID, the type of exchange (story start, help request, or turn), the learner's message, Sensei's reply, the notes it produced, the learner's setup choices and display settings, whether they used voice or text, any custom instructions, and response time. Download everything at:

```
/api/export?key=YOUR_ADMIN_KEY
```

## Changing Sensei's behavior

Edit `buildSystemPrompt` in `server.js`, then restart. The setup questions live in the `SETUP` list at the top of `public/app.js`.

## Deploying from GitHub

GitHub Pages can't run this app, because the API key has to stay on a server. Push the repository to GitHub and connect it to a Node host such as Render (`render.yaml` is included: New > Blueprint), Railway, or a university server. Set the same environment variables you used in `.env` (`PROVIDER`, your API key, the model, and `ADMIN_KEY`).

Logs are written to the `logs/` folder. On hosts with temporary file systems (including Render's free tier), attach a persistent disk or download the logs regularly, because they are erased when the service restarts.

## Privacy notes for the IRB

- Voice recordings are sent to OpenAI for transcription. If the server has no OpenAI key, the browser's own recognizer is used instead, which sends audio to Google (Chrome and Edge) or Apple (Safari).
- Messages are sent to OpenAI's or Anthropic's API to generate replies, depending on which provider you configure. Name the right one in your consent form.
- Logs contain everything participants type or say. Use coded participant IDs, not names.
- Conversations are also stored in the participant's own browser (localStorage) so they can resume; "New chat" clears it.

## Files

```
server.js          Server, model provider, Sensei's instructions, logging
public/index.html  Page
public/app.js      Chat, speech, settings
public/style.css   Styles
public/bg.svg      Background illustration (original)
```
