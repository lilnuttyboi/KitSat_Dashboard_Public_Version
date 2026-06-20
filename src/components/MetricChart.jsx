import { useMemo } from 'react';
import TelemetryChart from './TelemetryChart';

const CHART_MAX_POINTS = 2000;
const TICK_COUNT = 3; // X-akselin aikaleimat: alku, keskikohta, loppu — sama määrä joka kaaviossa, tasaisin välein

// Harvennetaan vain kaaviolle: säilytetään kunkin bucketin min ja max (piikit
// eivät katoa) ja pidetään aikajärjestys. Raakadata ei muutu tämän ulkopuolella.
function downsample(data, key) {
  if (data.length <= CHART_MAX_POINTS) return data;
  const bucketCount = Math.floor(CHART_MAX_POINTS / 2);
  const bucketSize = data.length / bucketCount;
  const out = [];
  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.floor((b + 1) * bucketSize);
    let minI = -1, maxI = -1;
    for (let i = start; i < end; i++) {
      const v = data[i][key];
      if (v == null || Number.isNaN(v)) continue;
      if (minI === -1 || v < data[minI][key]) minI = i;
      if (maxI === -1 || v > data[maxI][key]) maxI = i;
    }
    if (minI === -1) out.push(data[start]);
    else if (minI === maxI) out.push(data[minI]);
    else if (minI < maxI) out.push(data[minI], data[maxI]);
    else out.push(data[maxI], data[minI]);
  }
  return out;
}

// "Siisti" askel: pienin {1,2,5}×10^k joka on >= 0.01, jotta Y-pykälät osuvat
// aina korkeintaan kahden desimaalin arvoihin (esim. 0.01, 0.02, 0.05, 0.1, 1…).
function niceStep(range) {
  if (!(range > 0)) return 0.01;
  const raw = range / 4; // ~5 pykälää = 4 väliä
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? mag : norm <= 2 ? 2 * mag : norm <= 5 ? 5 * mag : 10 * mag;
  return Math.max(step, 0.01);
}

// Lasketaan Y-akselin domain ja pykälät itse, jotta labelit ovat korkeintaan
// kahden desimaalin tarkkoja eivätkä toistu kun datan vaihteluväli on pieni.
function computeYAxis(data, key) {
  let min = Infinity, max = -Infinity;
  for (const d of data) {
    const v = d[key];
    if (v == null || Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return { yDomain: ['auto', 'auto'], yTicks: undefined };
  const step = niceStep(max - min);
  const lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi <= lo) hi = lo + step;
  const yTicks = [];
  for (let t = lo; t <= hi + step / 2; t += step) yTicks.push(Number(t.toFixed(6)));
  return { yDomain: [Number(lo.toFixed(6)), Number(hi.toFixed(6))], yTicks };
}

export default function MetricChart({ history, dataKey, unit, color, rangeMs, yUnit, yScale, yDecimals }) {
  const { data, domain, ticks, yDomain, yTicks } = useMemo(() => {
    if (history.length === 0) return { data: history, domain: undefined, ticks: undefined, yDomain: undefined, yTicks: undefined };
    const firstMs = history[0].rawTimeMs;
    const latestMs = history[history.length - 1].rawTimeMs;

    let domStart, domEnd, chartData;
    if (rangeMs == null) {
      domStart = firstMs;
      domEnd = latestMs;
      chartData = history;
    } else if (latestMs - firstMs < rangeMs) {
      domStart = firstMs;
      domEnd = firstMs + rangeMs;
      chartData = history;
    } else {
      domStart = latestMs - rangeMs;
      domEnd = latestMs;
      chartData = history.filter((h) => h.rawTimeMs >= domStart);
    }

    const span = domEnd - domStart;
    const step = span > 0 ? span / (TICK_COUNT - 1) : 0;
    const tickArr = step > 0
      ? Array.from({ length: TICK_COUNT }, (_, i) => Math.round(domStart + step * i))
      : [domStart];

    const { yDomain, yTicks } = computeYAxis(chartData, dataKey);
    return { data: downsample(chartData, dataKey), domain: [domStart, domEnd], ticks: tickArr, yDomain, yTicks };
  }, [history, rangeMs, dataKey]);

  return (
    <div className="metric-chart">
      <div className="metric-chart-canvas">
        <TelemetryChart data={data} dataKey={dataKey} unit={unit} color={color} domain={domain} ticks={ticks} yDomain={yDomain} yTicks={yTicks} yScale={yScale} yUnit={yUnit} yDecimals={yDecimals} />
      </div>
    </div>
  );
}
