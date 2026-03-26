import React, { useMemo } from 'react';
import {
    BarChart, Bar,
    LineChart, Line,
    PieChart, Pie, Cell,
    ScatterChart, Scatter,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ZAxis,
} from 'recharts';

interface ChartSpec {
    type: 'bar' | 'line' | 'pie' | 'scatter';
    title?: string;
    xLabel?: string;
    yLabel?: string;
    series?: string[];
    colors?: string[];
    regression?: boolean;
    data: any[];
}

const PALETTE = ['#3b82f6', '#4ade80', '#f59e0b', '#f87171', '#a78bfa', '#38bdf8', '#fb923c', '#34d399'];

const CARD: React.CSSProperties = {
    background: 'white',
    borderRadius: '12px',
    padding: '16px 18px 12px',
    margin: '12px 0',
    boxShadow: '0 2px 10px rgba(30,58,138,0.1)',
    border: '1px solid rgba(30,58,138,0.08)',
};

const TITLE: React.CSSProperties = {
    textAlign: 'center',
    fontWeight: 700,
    fontSize: '13px',
    color: '#1e3a8a',
    marginBottom: '12px',
};

/** Compute linear regression line endpoints from scatter data */
function computeRegressionLine(data: { x: number; y: number }[]): [{ x: number; y: number }, { x: number; y: number }] | null {
    const n = data.length;
    if (n < 2) return null;
    const sumX = data.reduce((s, d) => s + d.x, 0);
    const sumY = data.reduce((s, d) => s + d.y, 0);
    const sumXY = data.reduce((s, d) => s + d.x * d.y, 0);
    const sumXX = data.reduce((s, d) => s + d.x * d.x, 0);
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return null;
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    const xs = data.map(d => d.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    return [
        { x: minX, y: parseFloat((slope * minX + intercept).toFixed(4)) },
        { x: maxX, y: parseFloat((slope * maxX + intercept).toFixed(4)) },
    ];
}

const ChartBlock: React.FC<{ raw: string }> = ({ raw }) => {
    const spec: ChartSpec | null = useMemo(() => {
        try {
            const parsed = JSON.parse(raw.trim());
            if (!parsed.type || !Array.isArray(parsed.data)) return null;
            return parsed as ChartSpec;
        } catch {
            return null;
        }
    }, [raw]);

    if (!spec) {
        return (
            <div style={{ ...CARD, color: '#ef4444', fontSize: '12px' }}>
                Invalid chart data
            </div>
        );
    }

    const colors = spec.colors && spec.colors.length ? spec.colors : PALETTE;
    const axisStyle = { fontSize: 11 };
    const xAxisLabel = spec.xLabel
        ? { value: spec.xLabel, position: 'insideBottom' as const, offset: -6, fontSize: 11, fill: '#64748b' }
        : undefined;
    const yAxisLabel = spec.yLabel
        ? { value: spec.yLabel, angle: -90, position: 'insideLeft' as const, fontSize: 11, fill: '#64748b' }
        : undefined;

    /* ---------- SCATTER (+ optional regression line) ---------- */
    if (spec.type === 'scatter') {
        const scatterData = spec.data as { x: number; y: number }[];
        const regLine = spec.regression ? computeRegressionLine(scatterData) : null;

        const CustomTooltip = ({ active, payload }: any) => {
            if (active && payload && payload.length) {
                const d = payload[0].payload;
                return (
                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
                        <div><strong>x:</strong> {d.x}</div>
                        <div><strong>y:</strong> {d.y}</div>
                    </div>
                );
            }
            return null;
        };

        return (
            <div style={CARD}>
                {spec.title && <div style={TITLE}>{spec.title}</div>}
                <ResponsiveContainer width="100%" height={260}>
                    <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: spec.xLabel ? 30 : 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,58,138,0.07)" />
                        <XAxis dataKey="x" type="number" name={spec.xLabel || 'x'} tick={axisStyle} label={xAxisLabel} />
                        <YAxis dataKey="y" type="number" name={spec.yLabel || 'y'} tick={axisStyle} label={yAxisLabel} />
                        <ZAxis range={[40, 40]} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend iconSize={10} />
                        <Scatter name="Data Points" data={scatterData} fill={colors[0]} opacity={0.8} />
                        {regLine && (
                            <Line
                                data={regLine}
                                type="linear"
                                dataKey="y"
                                stroke={colors[1] || '#ef4444'}
                                strokeWidth={2}
                                dot={false}
                                name="Regression Line"
                                legendType="line"
                            />
                        )}
                    </ScatterChart>
                </ResponsiveContainer>
                {regLine && (
                    <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b', marginTop: 4 }}>
                        Best-fit regression line shown in <span style={{ color: colors[1] || '#ef4444', fontWeight: 600 }}>red</span>
                    </div>
                )}
            </div>
        );
    }

    /* ---------- PIE ---------- */
    if (spec.type === 'pie') {
        return (
            <div style={CARD}>
                {spec.title && <div style={TITLE}>{spec.title}</div>}
                <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                        <Pie
                            data={spec.data}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={48}
                            outerRadius={80}
                            paddingAngle={3}
                            label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                            labelLine={false}
                        >
                            {spec.data.map((_: any, i: number) => (
                                <Cell key={i} fill={colors[i % colors.length]} />
                            ))}
                        </Pie>
                        <Tooltip formatter={(v: any) => v} />
                        <Legend iconSize={10} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        );
    }

    /* Normalize data: support {"x": ..., "y": ...} or {"name": ..., "value": ...} or multi-series */
    const normalised = spec.data.map((d: any) => ({
        ...d,
        _name: d.x !== undefined ? String(d.x) : d.name !== undefined ? String(d.name) : '',
    }));

    /* Determine series keys */
    const seriesKeys: string[] = spec.series && spec.series.length
        ? spec.series
        : (() => {
            if (!normalised[0]) return ['y'];
            const candidate = Object.keys(normalised[0]).filter(k => k !== 'x' && k !== 'name' && k !== '_name');
            return candidate.length ? candidate : ['y'];
        })();

    /* ---------- BAR ---------- */
    if (spec.type === 'bar') {
        return (
            <div style={CARD}>
                {spec.title && <div style={TITLE}>{spec.title}</div>}
                <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={normalised} margin={{ top: 5, right: 20, left: 10, bottom: spec.xLabel ? 30 : 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,58,138,0.07)" />
                        <XAxis dataKey="_name" tick={axisStyle} label={xAxisLabel} />
                        <YAxis tick={axisStyle} label={yAxisLabel} />
                        <Tooltip />
                        {seriesKeys.length > 1 && <Legend iconSize={10} />}
                        {seriesKeys.map((key, i) => (
                            <Bar key={key} dataKey={key} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} maxBarSize={54} />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        );
    }

    /* ---------- LINE ---------- */
    return (
        <div style={CARD}>
            {spec.title && <div style={TITLE}>{spec.title}</div>}
            <ResponsiveContainer width="100%" height={240}>
                <LineChart data={normalised} margin={{ top: 5, right: 20, left: 10, bottom: spec.xLabel ? 30 : 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,58,138,0.07)" />
                    <XAxis dataKey="_name" tick={axisStyle} label={xAxisLabel} />
                    <YAxis tick={axisStyle} label={yAxisLabel} />
                    <Tooltip />
                    {seriesKeys.length > 1 && <Legend iconSize={10} />}
                    {seriesKeys.map((key, i) => (
                        <Line
                            key={key}
                            dataKey={key}
                            stroke={colors[i % colors.length]}
                            strokeWidth={2}
                            dot={{ r: 3 }}
                            activeDot={{ r: 5 }}
                        />
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export default React.memo(ChartBlock);

