// quickTranslate / translateThreadBody (void2-final.html). The DOM dataset flags
// (original / translated / pending) become a per-key store so the in-flight guard and
// the restore-on-failure behave exactly like the web.
import { useEffect, useState } from 'react';
import { env } from '../../core';
import { settingsLang } from './format';

export interface TranslateState {
  /** translated text, when on */
  text: string | null;
  pending: boolean;
  lang: string;
}

const states: Record<string, TranslateState> = {};
const subs = new Map<string, Set<() => void>>();
const emit = (k: string) => subs.get(k)?.forEach((f) => f());

export function useTranslation(key: string): TranslateState {
  const [, setN] = useState(0);
  useEffect(() => {
    let s = subs.get(key);
    if (!s) subs.set(key, (s = new Set()));
    const f = () => setN((n) => n + 1);
    s.add(f);
    return () => {
      s!.delete(f);
    };
  }, [key]);
  return states[key] || { text: null, pending: false, lang: settingsLang() };
}

/** Toggle: translated -> original; original -> fetch. A second tap while pending is ignored. */
export async function toggleTranslate(key: string, original: string): Promise<void> {
  const cur = states[key];
  if (cur && cur.text != null) {
    delete states[key];
    emit(key);
    return;
  }
  if (cur && cur.pending) return;
  const lang = settingsLang();
  states[key] = { text: null, pending: true, lang };
  emit(key);
  try {
    const r = await env.fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(original)}`);
    const d = await r.json();
    const text = (d[0] as any[]).map((x) => x[0]).join('');
    states[key] = { text, pending: false, lang };
  } catch {
    delete states[key];
  }
  emit(key);
}
