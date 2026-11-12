import { parse } from 'node-html-parser';

export function avitoLink(href) {
  try {
    const u = new URL(href, 'https://www.avito.ru');
    if (!/(^|\.)avito\.ru$/.test(u.hostname)) return null;
    if (/_\d{6,}$/.test(u.pathname)) return 'https://www.avito.ru' + u.pathname;
    const b = u.pathname.match(/^\/(brands|user)\/[^/]+/);
    return b ? 'https://www.avito.ru' + b[0] : null;
  } catch {
    return null;
  }
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IMG', 'BUTTON', 'INPUT', 'SELECT', 'TEMPLATE', 'IFRAME', 'HEAD']);
const BLOCK = /^(DIV|P|LI|UL|OL|H[1-6]|SECTION|ARTICLE|HEADER|FOOTER|TR|TABLE|BR)$/;

export function htmlToText(html) {
  const root = parse(html, { comment: false });
  const body = root.querySelector('body') || root;
  const out = [];
  (function walk(node) {
    if (node.nodeType === 3) {
      out.push(node.text);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName?.toUpperCase() || '';
    if (SKIP.has(tag)) return;
    if (tag === 'A') {
      const text = node.text.replace(/\s+/g, ' ').trim();
      const link = avitoLink(node.getAttribute('href') || '');
      if (link && text) {
        out.push(` [${text}](${link}) `);
        return;
      }
    }
    const block = BLOCK.test(tag);
    if (block) out.push('\n');
    for (const c of node.childNodes) walk(c);
    if (block) out.push('\n');
  })(body);
  return tidy(out.join(''));
}

export function entitiesToText(text, entities = []) {
  const links = entities
    .filter((e) => e.type === 'text_link' || e.type === 'url')
    .map((e) => {
      const slice = text.slice(e.offset, e.offset + e.length);
      const link = avitoLink(e.type === 'url' ? slice : e.url);
      return link && { ...e, slice, link };
    })
    .filter(Boolean)
    .sort((a, b) => b.offset - a.offset);
  let out = text;
  for (const e of links) {
    const label = e.type === 'url' ? 'ссылка' : e.slice.replace(/\s+/g, ' ').trim();
    out = out.slice(0, e.offset) + `[${label}](${e.link})` + out.slice(e.offset + e.length);
  }
  return out;
}

function tidy(s) {
  return s
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
