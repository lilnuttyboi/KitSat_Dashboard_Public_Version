import { memo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const pad = (n) => String(n).padStart(2, '0');
// 24 h muoto (HH:MM:SS) on lyhyempi kuin "5:54:44 PM", joten X-akselin
// aikaleimat mahtuvat tasavälein eivätkä tungeksi tai harvene epätasaisesti.
const formatTimeLabel = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// Y-arvot oikealla reunalla: oma kaista, jonka leveys riittää pisimmälle
// leimalle (esim. "1006.3hPa"), joten ne eivät leikkaudu.
const Y_AXIS_WIDTH = 88;

const TelemetryChart = memo(({ data, dataKey, unit, color = "var(--primary)", domain, ticks, yDomain, yTicks }) => {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        {/* Vasen marginaali jättää tilaa keskitetylle ensimmäiselle aikaleimalle;
            Y-arvot ovat oikealla omalla kaistallaan. Viivojen värit tulevat
            App.css:stä (--chart-grid), joka ylikirjoittaa rechartsin attribuutit. */}
        <LineChart data={data} margin={{ top: 10, right: 0, left: 36, bottom: 36 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={true} />
          <XAxis
            dataKey="rawTimeMs"
            type="number"
            domain={domain ?? ['auto', 'auto']}
            ticks={ticks}
            scale="time"
            interval="preserveStartEnd"
            tickFormatter={formatTimeLabel}
            fontSize={16}
            tick={{ fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            minTickGap={24}
            dy={16}
          />
          <YAxis
            orientation="right"
            domain={yDomain ?? ['auto', 'auto']}
            ticks={yTicks}
            width={Y_AXIS_WIDTH}
            fontSize={16}
            tick={{ fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 500, textAnchor: 'start', dx: 4 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) => `${Number(value.toFixed(2))}${unit}`}
          />
          <Tooltip
            labelStyle={{ color: 'var(--text-main)', fontWeight: 'bold', fontSize: '11px', marginBottom: '4px', fontFamily: 'var(--font-sans)' }}
            contentStyle={{
              backgroundColor: 'var(--card-bg)',
              backdropFilter: 'blur(8px)',
              borderRadius: '4px',
              border: '1px solid var(--border)',
              padding: '8px',
              boxShadow: 'var(--shadow-lg)'
            }}
            itemStyle={{ color: color, fontSize: '11px', fontFamily: 'var(--font-mono)' }}
            cursor={{ strokeWidth: 1 }}
            labelFormatter={formatTimeLabel}
            formatter={(value) => [`${Number(value).toFixed(2)} ${unit}`, dataKey]}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 5, fill: color, stroke: 'var(--bg-color)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

export default TelemetryChart;
