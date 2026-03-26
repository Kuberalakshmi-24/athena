export interface GraphNode {
    id: string;
    label: string;
}

export interface GraphEdge {
    id: string;
    source: string;
    target: string;
    label?: string;
}

const slugifyNodeId = (value: string): string => {
    const base = (value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return base || 'node';
};

const isPlaceholderLabel = (label: string): boolean => {
    const normalized = (label || '').trim().toLowerCase();
    if (!normalized) return true;
    if (/^[a-z]$/.test(normalized)) return true;
    return ['node', 'start', 'end', 'process', 'step1', 'step2', 'step3'].includes(normalized);
};

const upsertNode = (nodesMap: Map<string, GraphNode>, incoming: GraphNode) => {
    const existing = nodesMap.get(incoming.id);
    if (!existing) {
        nodesMap.set(incoming.id, incoming);
        return;
    }

    const existingPlaceholder = isPlaceholderLabel(existing.label);
    const incomingPlaceholder = isPlaceholderLabel(incoming.label);

    // Keep the more descriptive label whenever possible.
    if (existingPlaceholder && !incomingPlaceholder) {
        nodesMap.set(incoming.id, incoming);
        return;
    }
    if (!existingPlaceholder && incomingPlaceholder) {
        return;
    }

    // If both are similar quality, prefer the longer readable label.
    if (incoming.label.length > existing.label.length) {
        nodesMap.set(incoming.id, incoming);
    }
};

const extractNodeLabel = (raw: string): { id: string; label: string } | null => {
    const trimmed = raw.trim();

    // A[Label] or A["Label"]
    const bracketMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*\[\s*"?([^\]]+?)"?\s*\]$/);
    if (bracketMatch) {
        return { id: bracketMatch[1], label: bracketMatch[2].replace(/^"|"$/g, '').trim() };
    }

    // A(Label)
    const roundMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*\(\s*"?([^)]+?)"?\s*\)$/);
    if (roundMatch) {
        return { id: roundMatch[1], label: roundMatch[2].replace(/^"|"$/g, '').trim() };
    }

    // A((Label))
    const doubleRoundMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*\(\(\s*"?([^)]+?)"?\s*\)\)$/);
    if (doubleRoundMatch) {
        return { id: doubleRoundMatch[1], label: doubleRoundMatch[2].replace(/^"|"$/g, '').trim() };
    }

    // A{Label}
    const curlyMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*\{\s*"?([^}]+?)"?\s*\}$/);
    if (curlyMatch) {
        return { id: curlyMatch[1], label: curlyMatch[2].replace(/^"|"$/g, '').trim() };
    }

    // Fallback: plain ID
    const idMatch = trimmed.match(/^([A-Za-z0-9_-]+)$/);
    if (idMatch) {
        return { id: idMatch[1], label: idMatch[1] };
    }

    return null;
};

const extractLooseNode = (raw: string): { id: string; label: string } | null => {
    const token = (raw || '').trim();
    if (!token) return null;

    const direct = extractNodeLabel(token);
    if (direct) return direct;

    // Handle raw labels that are not in Mermaid ID[label] form.
    const label = token
        .replace(/^"|"$/g, '')
        .replace(/^'|'$/g, '')
        .trim();

    if (!label) return null;
    return { id: slugifyNodeId(label), label };
};

const parseEdge = (line: string): { source: string; target: string; label?: string; leftNode?: { id: string; label: string }; rightNode?: { id: string; label: string } } | null => {
    const normalized = line.trim().replace(/\s+/g, ' ');

    // A[Node] -->|label| B[Node] (and -.->|label|, ==>|label|)
    let match = normalized.match(/^(.+?)\s*(?:-->|-\.->|==>)\|(.+?)\|\s*(.+)$/);
    if (match) {
        const leftNode = extractLooseNode(match[1]);
        const rightNode = extractLooseNode(match[3]);
        if (!leftNode || !rightNode) return null;
        return {
            source: leftNode.id,
            target: rightNode.id,
            label: match[2].trim(),
            leftNode,
            rightNode
        };
    }

    // A[Node] --> B[Node] (and -.->, ==> variants)
    match = normalized.match(/^(.+?)\s*(?:-->|-\.->|==>)\s*(.+)$/);
    if (match) {
        const leftNode = extractLooseNode(match[1]);
        const rightNode = extractLooseNode(match[2]);
        if (!leftNode || !rightNode) return null;
        return {
            source: leftNode.id,
            target: rightNode.id,
            leftNode,
            rightNode
        };
    }

    return null;
};

export const parseMermaidToGraph = (chart: string): { nodes: GraphNode[]; edges: GraphEdge[] } => {
    const nodesMap = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    const lines = chart
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .filter(l => !l.startsWith('graph '))
        .filter(l => !l.startsWith('flowchart '))
        .filter(l => !l.startsWith('style '))
        .filter(l => !l.startsWith('subgraph '))
        .filter(l => l !== 'end');

    for (const line of lines) {
        const edge = parseEdge(line);
        if (edge) {
            if (edge.leftNode) upsertNode(nodesMap, edge.leftNode);
            if (edge.rightNode) upsertNode(nodesMap, edge.rightNode);
            edges.push({
                id: `e-${edge.source}-${edge.target}-${edges.length}`,
                source: edge.source,
                target: edge.target,
                label: edge.label
            });
            continue;
        }

        const node = extractNodeLabel(line);
        if (node) {
            upsertNode(nodesMap, node);
        }
    }

    return {
        nodes: Array.from(nodesMap.values()),
        edges
    };
};
