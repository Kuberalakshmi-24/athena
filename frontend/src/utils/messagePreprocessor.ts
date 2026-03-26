export const preprocessMessageText = (text: string): string => {
    if (!text) return text;

    // Some model responses stream as raw language labels (e.g. "mermaid", "json")
    // without fences. Wrap those sections so markdown renders code/diagrams correctly.
    const wrapLooseLanguageBlocks = (input: string): string => {
        let out = input;

        const wrap = (lang: string, bodyPattern: string, stopPattern: string) => {
            const regex = new RegExp(
                `(^|\\n)\\s*${lang}\\s*\\n(${bodyPattern})(?=${stopPattern})`,
                'gi'
            );
            out = out.replace(regex, (_m, prefix, body) => {
                const content = String(body || '').trim();
                if (!content) return _m;
                return `${prefix}\n\`\`\`${lang}\n${content}\n\`\`\``;
            });
        };

        // Mermaid block that starts with graph/flowchart and runs until a known boundary.
        wrap(
            'mermaid',
            '[\\s\\S]*?(?:graph\\s+(?:TD|LR|TB|BT|RL)|flowchart\\s+\\w)[\\s\\S]*?',
            '\\n\\s*(?:json|javascript|typescript|python|sql|yaml|xml|html|chart)\\s*\\n|\\n{2,}|$'
        );

        // JSON block that starts with { or [ and may include blank lines.
        // Stop only at another language marker, a heading/sources marker, or end.
        wrap(
            'json',
            '\\s*[\\[{][\\s\\S]*?',
            '\\n\\s*(?:mermaid|javascript|typescript|python|sql|yaml|xml|html|chart)\\s*\\n|\\n\\s*(?:Sources:|#{1,6}\\s)|$'
        );

        return out;
    };

    const isDiagramLine = (line: string): boolean => {
        const s = (line || '').trim();
        if (!s) return true;
        if (s.toLowerCase() === 'mermaid') return true;
        if (/^(graph|flowchart|subgraph|style|class|classDef|linkStyle)\b/i.test(s)) return true;
        if (/^end$/i.test(s)) return true;
        if (s.includes('-->') || s.includes('->') || s.includes('=>') || s.includes('→') || s.includes('⇒')) return true;
        if (/^[A-Za-z0-9_-]+\s*\[[^\]]+\]/.test(s)) return true;
        return false;
    };

    // Normalize malformed inline fences so markdown parser recognizes diagram blocks.
    let normalized = text
        .replace(/→/g, '-->')
        .replace(/⇒/g, '-->')
        .replace(/->/g, '-->')
        .replace(/```\s*mermaid\s*/gi, '\n```mermaid\n')
        .replace(/```\s*graph\s*/gi, '\n```mermaid\n')
        .replace(/\s*```\s*/g, '\n```\n');

    normalized = wrapLooseLanguageBlocks(normalized);

    if (normalized.includes('```mermaid')) {
        const start = normalized.indexOf('```mermaid');
        const afterStart = normalized.slice(start + '```mermaid'.length);
        const closeRel = afterStart.indexOf('```');

        if (closeRel !== -1) {
            const before = normalized.slice(0, start);
            const block = afterStart.slice(0, closeRel);
            const after = afterStart.slice(closeRel + 3);

            const blockLines = block
                .split('\n')
                .map(l => l.trim())
                .filter(Boolean)
                .filter(l => l.toLowerCase() !== 'mermaid' && l !== '```');

            const afterLines = after.split('\n');
            const continuation: string[] = [];
            const remaining: string[] = [];
            let collecting = true;

            for (const line of afterLines) {
                if (collecting && isDiagramLine(line)) {
                    const fixed = line.trim().replace(/→/g, '-->').replace(/⇒/g, '-->').replace(/->/g, '-->');
                    if (fixed && fixed.toLowerCase() !== 'mermaid' && fixed !== '```') {
                        continuation.push(fixed);
                    }
                    continue;
                }
                collecting = false;
                remaining.push(line);
            }

            const mergedLines = [...blockLines, ...continuation]
                .filter(Boolean)
                .filter((line, idx, arr) => arr.indexOf(line) === idx || !line.startsWith('style '));

            if (mergedLines.length > 0) {
                return `${before}\n\`\`\`mermaid\n${mergedLines.join('\n')}\n\`\`\`\n${remaining.join('\n')}`.trim();
            }
        }

        return normalized;
    }

    const mermaidRegex = /(^graph\s+(?:TD|LR|TB|BT|RL)[\s\S]+?(?=[\n\r]{2,}|---|\nSources:|$))/m;
    const match = normalized.match(mermaidRegex);

    if (match && match[0].includes('-->')) {
        const original = match[0];
        const wrapped = `\n\`\`\`mermaid\n${original.trim()}\n\`\`\`\n`;
        return normalized.replace(original, wrapped);
    }

    return normalized;
};
