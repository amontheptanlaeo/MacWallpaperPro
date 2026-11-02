#!/usr/bin/env node
// Verify that every language file has exactly the keys of en.json, no empty values, and the same
// {placeholders}. Exit code 1 on any problem. (Also enforced by test/i18n.test.ts.)
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../public/i18n");
const LANGS = ["en", "th", "zh-Hans", "zh-Hant", "ja", "ko", "es", "fr", "de", "it", "pt-BR", "ru", "tr", "id", "vi", "hi", "ar"];
const en = JSON.parse(readFileSync(join(dir, "en.json"), "utf8"));
const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");
let bad = 0;
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
for (const l of LANGS) if (!files.includes(l)) (console.error(`missing file: ${l}.json`), bad++);
for (const l of files) {
  if (!LANGS.includes(l)) (console.error(`unexpected file: ${l}.json`), bad++);
  const d = JSON.parse(readFileSync(join(dir, `${l}.json`), "utf8"));
  for (const k of Object.keys(en)) {
    if (!(k in d)) (console.error(`${l}: missing ${k}`), bad++);
    else if (!String(d[k]).trim()) (console.error(`${l}: empty ${k}`), bad++);
    else if (ph(d[k]) !== ph(en[k])) (console.error(`${l}: placeholders differ in ${k}`), bad++);
  }
  for (const k of Object.keys(d)) if (!(k in en)) (console.error(`${l}: extra key ${k}`), bad++);
}
if (bad) process.exit(1);
console.log(`i18n OK: ${files.length} languages x ${Object.keys(en).length} keys`);
