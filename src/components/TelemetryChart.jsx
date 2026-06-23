import { memo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const pad = (n) => String(n).padStart(2, '0');
// 24 h muoto (HH:MM:SS) on lyhyempi kuin "5:54:44 PM", joten X-akselin
// aikaleimat mahtuvat tasavälein eivätkä tungeksi tai harvene epätasaisesti.
const formatTimeLabel = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// X-akselin aikaleima: kun kaavio on tasattu vasempaan reunaan (margin.left = 0),
// keskitetty ensimmäinen leima leikkautuisi kortin reunan yli. Siksi ensimmäinen
// leima tasataan vasemmalle ja viimeinen oikealle, väliset keskitetään.
function XTick({ x, y, payload, index, visibleTicksCount }) {
  const anchor = index === 0 ? 'start' : index === visibleTicksCount - 1 ? 'end' : 'middle';
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={16}
        textAnchor={anchor}
        style={{ fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 16 }}
      >
        {formatTimeLabel(payload.value)}
      </text>
    </g>
  );
}

const TelemetryChart = memo(({ data, dataKey, unit, color = "var(--primary)", domain, ticks, yDomain, yTicks, yScale = 1, yUnit, yDecimals = 2, showAxisUnits = false }) => {
  // Kaavion arvoyksikkö voi poiketa päämittarista (ilmanpaine: hPa → kPa).
  const axisUnit = yUnit ?? unit;

  // Y-akselin pykälät näytetään kaavion arvoyksikössä (jaetaan yScalella) ja
  // pyöristetään turhia desimaalinollia karsien (esim. 2000.00 → 2000,
  // 1022.80 → 1022.8). Näkyvät vain kun käyttäjä on kytkenyt asteikon päälle.
  // Yksikkösymboleja ei näytetä akselilla (ne leikkautuisivat); yksikkö näkyy
  // tooltipissa ja kortin pääarvossa.
  const yTickFormatter = (v) => String(Number((v / yScale).toFixed(yDecimals)));

  // Akselikaistan leveys mitoitetaan pisimmän pykälämerkkijonon mukaan, jottei
  // esim. ilmanpaineen "1022.8" leikkaudu — ja kapeat kaaviot (esim. nopeus
  // "1.5") eivät tuhlaa tilaa. Monospace ~9px/merkki + reunavarat.
  const maxTickLen = yTicks && yTicks.length
    ? yTicks.reduce((m, t) => Math.max(m, yTickFormatter(t).length), 0)
    : 4;
  const yAxisWidth = showAxisUnits ? Math.max(44, Math.round(maxTickLen * 9) + 14) : 0;

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        {/* Kaavio täyttää oletuksena koko kortin leveyden: ei Y-akselin kaistaa,
            joten viiva alkaa vasemmasta reunasta ja päättyy oikeaan (margin 0
            molemmin puolin). Y-akselin domain skaalaa viivan ja sen pykälät
            asettavat vaaka-apuviivat myös piilotettuna. Kun asteikko on päällä,
            akseli näytetään oikealla (varaa oman kaistansa). Reuna-
            aikaleimat tasataan XTickissä sisäänpäin, etteivät ne leikkaudu.
            Apuviivojen värit tulevat App.css:stä (--chart-grid). */}
        <LineChart data={data} margin={{ top: 10, right: 0, left: 0, bottom: 36 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={true} />
          <XAxis
            dataKey="rawTimeMs"
            type="number"
            domain={domain ?? ['auto', 'auto']}
            ticks={ticks}
            scale="time"
            interval={0}
            tick={<XTick />}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
          />
          <YAxis
            orientation="right"
            domain={yDomain ?? ['auto', 'auto']}
            ticks={yTicks}
            hide={!showAxisUnits}
            width={yAxisWidth}
            tickFormatter={yTickFormatter}
            tick={{ fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 14 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
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
            formatter={(value) => [`${(value / yScale).toFixed(yDecimals)} ${axisUnit}`, dataKey]}
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
