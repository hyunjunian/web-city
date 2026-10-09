// docs/API.md's text: every public City method with its signature and doc comment,
// read from the source of src/city.ts (shared by the docs script and its test).
export function apiDocText(src: string): { text: string; methods: number } {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.startsWith('export class City'));
  const out: string[] = [];
  let doc: string[] = [];
  let inDoc = false;
  for (let k = start + 1; k < lines.length; k++) {
    const line = lines[k]!;
    const t = line.trim();
    if (line.startsWith('}')) break;
    if (t.startsWith('/**')) {
      inDoc = true;
      doc = [];
    }
    if (inDoc) {
      const text = t.replace(/^\/\*\*\s?/, '').replace(/\*\/$/, '').replace(/^\*\s?/, '').trim();
      if (text) doc.push(text);
      if (t.endsWith('*/')) inDoc = false;
      continue;
    }
    // Public methods sit at two-space indent: name<T>(args): type {
    const m = /^ {2}(?!private |static |readonly |get |set )([a-zA-Z]\w*)(<[^>]*>)?\((.*)\)(?::\s*(.+?))?\s*\{$/.exec(line);
    if (m && m[1] !== 'constructor') {
      let ret = m[4]?.trim() ?? '';
      // A return type spread over lines: `): {` … `} {`.
      if (line.endsWith('): {')) {
        const body: string[] = [];
        while (k + 1 < lines.length && !/^ {2}\}.* \{$/.test(lines[k + 1]!)) body.push(lines[++k]!.trim());
        ret = `{ ${body.join(' ').replace(/\/\*\*.*?\*\/\s*/g, '')} ${lines[++k]!.trim().replace(/\s*\{$/, '')}`;
      }
      out.push(`### \`${m[1]}${m[2] ?? ''}(${m[3]})${ret ? `: ${ret}` : ''}\`\n\n${doc.join(' ') || '—'}\n`);
    }
    if (t && !t.startsWith('//') && !t.startsWith('@')) doc = [];
  }
  const text = `# City API

\`new City(options)\` 또는 \`loadCity(save)\`로 만든 도시의 공개 메서드 목록입니다. \`src/city.ts\`의 주석에서
\`npm run docs\`로 생성합니다(직접 고치지 마세요). 엔진은 Node·DOM API를 쓰지 않으므로 브라우저와 Cloudflare Workers에서 똑같이 동작합니다.

${out.join('\n')}`;
  return { text, methods: out.length };
}
