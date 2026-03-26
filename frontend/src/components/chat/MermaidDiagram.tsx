import React, { useEffect, useMemo, useRef, useState } from 'react';
import dagre from 'dagre';
import ReactFlow, { Background, Controls, Edge, MarkerType } from 'reactflow';
import 'reactflow/dist/style.css';
import { sanitizeMermaidChart } from '../../utils/sanitizeMermaid';
import { getMermaidConfig, markMermaidInitialized, mermaidAlreadyInitialized } from '../../utils/sanitizeMermaid';
import { parseMermaidToGraph } from '../../utils/graphParser';
import mermaid from 'mermaid';

type FlowNode = {
    id: string;
    data: { label: string };
    position: { x: number; y: number };
    style?: React.CSSProperties;
};

type FlowEdge = Edge;

interface MermaidDiagramProps {
    chart: string;
    isTyping?: boolean;
}

const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ chart, isTyping = false }) => {
    const canvasRef = useRef<HTMLDivElement>(null);
    const mermaidHostRef = useRef<HTMLDivElement>(null);
    const [canvasReady, setCanvasReady] = useState(false);
    const [mermaidSvg, setMermaidSvg] = useState('');
    const [mermaidFailed, setMermaidFailed] = useState(false);

    const cleanChart = useMemo(() => {
        if (!chart) return '';
        return sanitizeMermaidChart(chart);
    }, [chart]);

    useEffect(() => {
        // Skip rendering during streaming — prevents Mermaid from injecting
        // orphaned error elements ("Syntax error in text") into document.body.
        if (isTyping) {
            setMermaidSvg('');
            setMermaidFailed(false);
            return;
        }

        let cancelled = false;
        const renderId = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const renderMermaid = async () => {
            if (!cleanChart) {
                setMermaidSvg('');
                setMermaidFailed(true);
                return;
            }

            try {
                if (!mermaidAlreadyInitialized()) {
                    mermaid.initialize(getMermaidConfig() as any);
                    markMermaidInitialized();
                }

                const { svg } = await mermaid.render(renderId, cleanChart);

                if (!cancelled) {
                    setMermaidSvg(svg);
                    setMermaidFailed(false);
                }
            } catch {
                // Remove any orphaned element Mermaid may have left in <body>.
                const orphan = document.getElementById(renderId);
                if (orphan) orphan.remove();

                if (!cancelled) {
                    setMermaidSvg('');
                    setMermaidFailed(true);
                }
            }
        };

        renderMermaid();

        return () => {
            cancelled = true;
        };
    }, [cleanChart, isTyping]);

    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;

        const updateReady = () => {
            const rect = el.getBoundingClientRect();
            setCanvasReady(rect.width > 20 && rect.height > 20);
        };

        updateReady();

        // Safety net: avoid getting stuck in non-ready state due delayed layout passes.
        const forceReady = setTimeout(() => {
            setCanvasReady(true);
        }, 180);

        const observer = new ResizeObserver(() => updateReady());
        observer.observe(el);
        return () => {
            clearTimeout(forceReady);
            observer.disconnect();
        };
    }, []);

    const direction = useMemo(() => {
        const text = (chart || '').toLowerCase();
        if (text.includes('graph td')) return 'TB';
        if (text.includes('graph lr')) return 'LR';
        return 'LR';
    }, [chart]);

    const graphData = useMemo(() => {
        if (!cleanChart) return { nodes: [], edges: [] };
        return parseMermaidToGraph(cleanChart);
    }, [cleanChart]);

    const layouted = useMemo(() => {
        // Wrap in try/catch: dagre can crash on partially-streamed or malformed
        // diagrams (g.node() returns undefined → pos.x throws).  An error here
        // would propagate through the render phase before the isTyping early-return
        // check, bubbling past the ErrorBoundary and corrupting the layout.
        try {
            const g = new dagre.graphlib.Graph();
            g.setDefaultEdgeLabel(() => ({}));
            g.setGraph({ rankdir: direction, nodesep: 10, ranksep: 14 });

            const nodes: FlowNode[] = graphData.nodes.map(node => {
                g.setNode(node.id, { width: 96, height: 30 });
                return {
                    id: node.id,
                    data: { label: node.label },
                    position: { x: 0, y: 0 },
                    style: {
                        borderRadius: 8,
                        border: '1px solid #93c5fd',
                        background: '#eff6ff',
                        color: '#1e3a8a',
                        fontWeight: 600,
                        fontSize: 10,
                        padding: 4
                    }
                };
            });

            const edges: FlowEdge[] = graphData.edges.map(edge => {
                g.setEdge(edge.source, edge.target);
                return {
                    id: edge.id,
                    source: edge.source,
                    target: edge.target,
                    label: edge.label,
                    animated: false,
                    markerEnd: { type: MarkerType.ArrowClosed },
                    style: { stroke: '#64748b', strokeWidth: 1.2 },
                    labelStyle: { fill: '#334155', fontSize: 9, fontWeight: 600 }
                };
            });

            dagre.layout(g);

            nodes.forEach(node => {
                const pos = g.node(node.id);
                if (pos) {
                    node.position = { x: pos.x - 48, y: pos.y - 15 };
                }
            });

            return { nodes, edges };
        } catch {
            return { nodes: [], edges: [] };
        }
    }, [direction, graphData.edges, graphData.nodes]);

    if (isTyping && !mermaidSvg && !mermaidFailed) {
        return (
            <div style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', margin: '10px 0' }}>
                Generating diagram...
            </div>
        );
    }

    if (mermaidSvg && !mermaidFailed) {
        return (
            <div className="static-diagram-container mermaid-svg-container">
                <div
                    className="mermaid-svg-wrapper"
                    ref={mermaidHostRef}
                    dangerouslySetInnerHTML={{ __html: mermaidSvg }}
                />
            </div>
        );
    }

    if (!mermaidFailed && !mermaidSvg) {
        return (
            <div className="static-diagram-container" style={{ minHeight: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center', fontSize: '12px', color: '#94a3b8' }}>
                    Rendering diagram...
                </div>
            </div>
        );
    }

    if (layouted.nodes.length === 0) {
        return (
            <div className="static-diagram-container" style={{ minHeight: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '600' }}>Unable to render this diagram format.</span>
                </div>
            </div>
        );
    }

    return (
        <div
  className="static-diagram-container concept-graph"
  style={{
    margin: '8px 0',
        minHeight: '220px',
        height: '220px',
        overflow: 'hidden',
    display: 'flex',
    justifyContent: 'center'
  }}
>
            <div className="concept-graph-canvas" ref={canvasRef}>
                {canvasReady ? (
                    <ReactFlow
                        nodes={layouted.nodes}
                        edges={layouted.edges}
                        style={{ width: '100%', height: '100%' }}
                        fitView
                        nodesConnectable={false}
                        elementsSelectable
                        panOnDrag
                        zoomOnScroll
                        proOptions={{ hideAttribution: true }}
                    >
                        <Background color="#cbd5e1" gap={22} />
                        <Controls showInteractive={false} />
                    </ReactFlow>
                ) : (
                    <div style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', paddingTop: '18px' }}>
                        Rendering diagram...
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(MermaidDiagram);
