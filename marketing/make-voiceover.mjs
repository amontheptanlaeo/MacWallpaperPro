#!/usr/bin/env node
// Generates the voiceover tracks for the MacWallpaperPro promo videos with Gemini TTS.
//
//   node marketing/make-voiceover.mjs [--voice Sulafat] [--only teaser-en,teaser-th,showcase-en] [--out DIR]
//
// The API key is read from secrets/gemini.key (git-ignored) or $GEMINI_API_KEY. It is never printed.
// One request per script; each script's lines are separated by <long pause> markers so the
// render step can split the audio back into lines with ffmpeg silencedetect.
// Output: <out>/<id>-<voice>.wav (default .build/vo-cache, git-ignored) (24 kHz mono 16-bit). Existing files are reused (cache), so
// re-running costs no requests unless you delete them.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const VOICE = arg('--voice', 'Sulafat');
const OUT = resolve(arg('--out', join(here, '..', '.build', 'vo-cache'))); // .build/ is git-ignored
const ONLY = arg('--only', '')?.split(',').filter(Boolean);
const MODELS = ['gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts'];
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
const KEY = isMain ? (process.env.GEMINI_API_KEY || readFileSync(join(here, '..', 'secrets', 'gemini.key'), 'utf8').trim()) : '';

// Keep in sync with "Voiceover scripts" in CAPTIONS.md.
export const SCRIPTS = {
  // Short line for auditioning voices: --only sample --voice <Name>
  sample: { style: 'warm, relaxed and modern; friendly, not salesy', lines: ['Your Mac, but alive. Wallpapers that react to you.'], skipByDefault: true },
  'teaser-en': {
    style: 'warm, relaxed and modern; a friendly young narrator, quietly delighted, not salesy; unhurried',
    lines: [
      'Your Mac, but alive.',
      'Wallpapers that react to you.',
      'Move. Click. Watch them respond.',
      'Interactive and video wallpapers, one click to install.',
      'Free, open source, and no account needed.',
      'MacWallpaperPro. Get it at macwallpaper dot elizos dot com.',
    ],
  },
  'teaser-th': {
    style: 'warm, relaxed and modern Thai narrator, friendly and natural, not salesy; unhurried',
    lines: [
      'แมคของคุณ… แต่มีชีวิต',
      'วอลเปเปอร์ที่ตอบสนองต่อคุณ',
      'ขยับเมาส์ คลิก แล้วดูมันขยับตาม',
      'มีทั้งวอลเปเปอร์อินเทอร์แอกทีฟและวิดีโอ ติดตั้งได้ในคลิกเดียว',
      'ฟรี โอเพนซอร์ส ไม่ต้องสมัครบัญชี',
      'แมควอลเปเปอร์โปร ดาวน์โหลดได้ที่ macwallpaper dot elizos dot com',
    ],
  },
  'showcase-en': {
    style: 'warm, calm and modern; a friendly narrator for a design-led product film; natural, unhurried, not salesy',
    lines: [
      'This is your Mac... but alive.',
      'MacWallpaperPro brings live wallpapers to macOS, and they react to your cursor.',
      'Koi follow you around. A click sets off fireworks, ripples, and shooting stars.',
      'Pick from nineteen free wallpapers in the Community store, and install any of them in one click.',
      'Plus a desktop clock, glowing window borders, window snapping, and menu bar tools.',
      'Community wallpapers run offline in a sandbox, and every file is signature-verified.',
      'Free, open source, no account. Get it at macwallpaper dot elizos dot com.',
    ],
  },
};

function wavFromPcm(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
const toWav = b => (b.slice(0, 4).toString() === 'RIFF' ? b : wavFromPcm(b));

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${j.error?.message || 'request failed'}`);
  return j;
}

// 1) Interactions API (current docs). 2) Legacy generateContent shape.
async function tts(model, text, style) {
  // Speech annotations (style) are only supported by the 3.x TTS models; older ones get the style as a lead-in.
  const annotated = /gemini-3/.test(model);
  try {
    const content = annotated
      ? { type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }
      : { type: 'text', text: `Read this in a ${style} voice, pausing between sentences: ${text}` };
    const j = await post('https://generativelanguage.googleapis.com/v1beta/interactions', {
      model,
      input: [{ type: 'user_input', content: [content] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: VOICE }] },
    });
    const blocks = (j.steps || []).flatMap(s => s.content || []).filter(c => c.data);
    if (blocks.length) return toWav(Buffer.from(blocks.at(-1).data, 'base64'));
    throw new Error('no audio in interactions response');
  } catch (e) {
    console.warn(`  interactions failed (${e.message}); trying generateContent`);
  }
  const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    contents: [{ parts: [{ text: `Say in a ${style} voice:\n${text}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
  });
  const part = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
  if (!part) throw new Error('no audio in generateContent response');
  return toWav(Buffer.from(part.inlineData.data, 'base64'));
}

if (isMain) mkdirSync(OUT, { recursive: true });
if (isMain) for (const [id, s] of Object.entries(SCRIPTS)) {
  if (ONLY?.length ? !ONLY.includes(id) : s.skipByDefault) continue;
  const file = join(OUT, `${id}-${VOICE}.wav`);
  if (existsSync(file)) { console.log('cached', file); continue; }
  const text = s.lines.join(' <long pause> ');
  let ok = false;
  for (const m of MODELS) {
    try { console.log(`${id}: ${m} / ${VOICE}`); writeFileSync(file, await tts(m, text, s.style)); ok = true; console.log('wrote', file); break; }
    catch (e) { console.warn(`  ${m}: ${e.message}`); }
  }
  if (!ok) process.exitCode = 1;
  await new Promise(r => setTimeout(r, 7000)); // stay well under free-tier RPM
}
