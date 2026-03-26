let isMermaidInitialized = false;

export const getMermaidConfig = () => ({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'loose',
    fontFamily: 'Segoe UI, system-ui, sans-serif',
    fontSize: 14,
    flowchart: {
        htmlLabels: true,
        curve: 'basis',
        nodeSpacing: 22,
        rankSpacing: 28,
        useMaxWidth: true,
        padding: 10
    },
    themeVariables: {
        background: '#ffffff',
        primaryColor: '#eff6ff',
        primaryBorderColor: '#3b82f6',
        primaryTextColor: '#1e3a8a',
        secondaryColor: '#f0fdf4',
        secondaryBorderColor: '#22c55e',
        tertiaryColor: '#fefce8',
        tertiaryBorderColor: '#eab308',
        lineColor: '#64748b',
        edgeLabelBackground: '#f8fafc',
        fontSize: '13px',
        nodeBorder: '1.5px',
        clusterBkg: '#f0f9ff',
        clusterBorder: '#bfdbfe'
    }
});

export const markMermaidInitialized = () => {
    isMermaidInitialized = true;
};

export const mermaidAlreadyInitialized = () => isMermaidInitialized;

export const sanitizeMermaidChart = (rawChart: string): string => {
    if (!rawChart) return 'graph TD\nA[No Data] --> B[Try another question]';

    let text = rawChart
        .replace(/\r\n/g, '\n')
        .replace(/```mermaid/gi, '')
        .replace(/```/g, '');

    text = text.replace(/(\w+)\s*\["([^"]+)"\]\s*→\s*(\w+)\s*\["([^"]+)"\]/g, '$1["$2"] --> $3["$4"]');
    text = text.replace(/(\w+)\s*\[([^\]]+)\]\s*→\s*(\w+)\s*\[([^\]]+)\]/g, '$1[$2] --> $3[$4]');
    text = text.replace(/→/g, '-->');
    text = text.replace(/⇒/g, '-->');
    text = text.replace(/==>/g, '-->');
    text = text.replace(/=>/g, '-->');

    const lines = text.split('\n');
    const cleaned: string[] = [];

    for (const originalLine of lines) {
        const trimmed = originalLine.trim();
        if (!trimmed) continue;
        if (/^---QUIZ---$/i.test(trimmed) || /^---ENDQUIZ---$/i.test(trimmed) || /^Q\d+:/i.test(trimmed)) {
            break;
        }

        let line = originalLine
            .replace(/\|([^|]+)\|>/g, '|$1|')
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'");

        line = line.replace(/([A-Z0-9_-]+)\s*\[\s*([^"\]]*[()][^"\]]*)\s*\]/gi, '$1["$2"]');

        if (/(?:-->|--|->|=>|→|⇒|\|)\s*$/.test(trimmed)) {
            continue;
        }
        if (/^[a-z0-9_-]+$/i.test(trimmed) && trimmed.length < 5) {
            continue;
        }

        const openSquare = (line.match(/\[/g) || []).length;
        const closeSquare = (line.match(/\]/g) || []).length;
        if (openSquare > closeSquare) {
            line += ']'.repeat(openSquare - closeSquare);
        }

        const openParen = (line.match(/\(/g) || []).length;
        const closeParen = (line.match(/\)/g) || []).length;
        if (openParen > closeParen) {
            line += ')'.repeat(openParen - closeParen);
        }

        cleaned.push(line);
    }

    if (cleaned.length === 0) {
        return 'graph TD\nA[No Diagram] --> B[Ask another question]';
    }

    const hasConnection = cleaned.some(l => l.includes('-->') || l.includes('->') || l.includes('==>') || l.includes('=>'));
    if (cleaned.length < 2 || !hasConnection) {
        return '';
    }

    const startsWithDiagram = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline)\b/i.test(cleaned[0].trim());
    if (!startsWithDiagram) {
        cleaned.unshift('graph TD');
    }

    return cleaned.join('\n');
};
