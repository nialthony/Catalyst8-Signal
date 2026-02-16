/**
 * Crypto Signal Generator
 * Fetches market data and generates trading signals using technical analysis
 */

const SYMBOL_MAP = {
  BTCUSDT: { name: 'Bitcoin', geckoId: 'bitcoin' },
  ETHUSDT: { name: 'Ethereum', geckoId: 'ethereum' },
  SOLUSDT: { name: 'Solana', geckoId: 'solana' },
  BNBUSDT: { name: 'BNB', geckoId: 'binancecoin' },
  XRPUSDT: { name: 'Ripple', geckoId: 'ripple' },
  ADAUSDT: { name: 'Cardano', geckoId: 'cardano' },
  AVAXUSDT: { name: 'Avalanche', geckoId: 'avalanche-2' },
  DOGEUSDT: { name: 'Dogecoin', geckoId: 'dogecoin' },
};

// ── Data Fetching ───────────────────────────────────────────────────────────

async function fetchFromBinance(symbol, timeframe, limit = 100) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const data = await res.json();
  return data.map((c) => ({
    timestamp: c[0],
    open: +c[1],
    high: +c[2],
    low: +c[3],
    close: +c[4],
    volume: +c[5],
  }));
}

async function fetchFromCoinGecko(symbol, timeframe, limit = 100) {
  const geckoId = SYMBOL_MAP[symbol]?.geckoId || 'bitcoin';
  const daysMap = { '15m': 1, '1h': 3, '4h': 7, '1d': 90 };
  const days = daysMap[timeframe] || 7;
  const interval = ['15m', '1h', '4h'].includes(timeframe) ? 'hourly' : 'daily';
  const url = `https://api.coingecko.com/api/v3/coins/${geckoId}/market_chart?vs_currency=usd&days=${days}&interval=${interval}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json();
  const prices = data.prices || [];
  const volumes = data.total_volumes || [];
  return prices.slice(-limit).map((p, i) => ({
    timestamp: p[0],
    open: p[1],
    high: p[1] * 1.005,
    low: p[1] * 0.995,
    close: p[1],
    volume: volumes[i] ? volumes[i][1] : 0,
  }));
}

function generateDemoData(symbol, timeframe, limit = 100) {
  const basePrices = {
    BTCUSDT: 96500, ETHUSDT: 2700, SOLUSDT: 195, BNBUSDT: 640,
    XRPUSDT: 2.65, ADAUSDT: 0.78, AVAXUSDT: 36, DOGEUSDT: 0.26,
  };
  let price = basePrices[symbol] || 50000;

  // Deterministic seed from symbol+timeframe
  let seed = 0;
  for (const ch of symbol + timeframe) seed = ((seed << 5) - seed + ch.charCodeAt(0)) | 0;
  const rand = () => { seed = (seed * 16807 + 0) % 2147483647; return (seed & 0x7fffffff) / 2147483647; };

  const trend = rand() > 0.5 ? 1 : -1;
  const volatility = 0.01 + rand() * 0.02;
  const msMap = { '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
  const intervalMs = msMap[timeframe] || 14400000;
  let ts = Date.now() - limit * intervalMs;

  const ohlcv = [];
  for (let i = 0; i < limit; i++) {
    const change = (rand() - 0.5 + trend * 0.002) * volatility;
    price *= 1 + change;
    const high = price * (1 + rand() * volatility * 0.5);
    const low = price * (1 - rand() * volatility * 0.5);
    const close = low + rand() * (high - low);
    ohlcv.push({ timestamp: ts, open: price, high, low, close, volume: 100000 + rand() * 400000 });
    ts += intervalMs;
    price = close;
  }
  return ohlcv;
}

async function fetchOHLCV(symbol, timeframe, limit = 100) {
  try {
    return await fetchFromBinance(symbol, timeframe, limit);
  } catch {
    try {
      return await fetchFromCoinGecko(symbol, timeframe, limit);
    } catch {
      return generateDemoData(symbol, timeframe, limit);
    }
  }
}

// ── Technical Indicators ────────────────────────────────────────────────────

function sma(prices, period) {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((s, v) => s + v, 0) / period;
}

function ema(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let e = prices.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < prices.length; i++) e = prices[i] * k + e * (1 - k);
  return e;
}

function rsi(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let avgGain = 0, avgLoss = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function macd(prices) {
  if (prices.length < 26) return { line: null, signal: null, histogram: null };
  const ema12 = ema(prices, 12);
  const ema26 = ema(prices, 26);
  if (ema12 === null || ema26 === null) return { line: null, signal: null, histogram: null };
  const line = ema12 - ema26;

  // Compute proper signal line from MACD history
  const macdHistory = [];
  const k12 = 2 / 13, k26 = 2 / 27;
  let e12 = prices.slice(0, 12).reduce((s, v) => s + v, 0) / 12;
  let e26 = prices.slice(0, 26).reduce((s, v) => s + v, 0) / 26;
  for (let i = 12; i < 26; i++) e12 = prices[i] * k12 + e12 * (1 - k12);
  for (let i = 26; i < prices.length; i++) {
    e12 = prices[i] * k12 + e12 * (1 - k12);
    e26 = prices[i] * k26 + e26 * (1 - k26);
    macdHistory.push(e12 - e26);
  }

  let signalLine = null;
  if (macdHistory.length >= 9) {
    const k9 = 2 / 10;
    signalLine = macdHistory.slice(0, 9).reduce((s, v) => s + v, 0) / 9;
    for (let i = 9; i < macdHistory.length; i++) signalLine = macdHistory[i] * k9 + signalLine * (1 - k9);
  }

  return {
    line,
    signal: signalLine,
    histogram: signalLine !== null ? line - signalLine : null,
  };
}

function bollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return { upper: null, middle: null, lower: null };
  const mid = sma(prices, period);
  const slice = prices.slice(-period);
  const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mid + stdDev * sd, middle: mid, lower: mid - stdDev * sd };
}

// ── Signal Scoring ──────────────────────────────────────────────────────────

function avg(values) {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values) {
  if (!values.length) return null;
  const mean = avg(values);
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function momentum(prices, period) {
  if (prices.length <= period) return null;
  const base = prices[prices.length - 1 - period];
  if (!base) return null;
  return (prices[prices.length - 1] - base) / base;
}

function atr(ohlcv, period = 14) {
  if (ohlcv.length < period + 1) return null;
  const trs = [];
  for (let i = ohlcv.length - period; i < ohlcv.length; i++) {
    const high = ohlcv[i].high;
    const low = ohlcv[i].low;
    const prevClose = ohlcv[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    trs.push(tr);
  }
  return avg(trs);
}

function analyzeIndicators(ohlcv) {
  const closes = ohlcv.map((c) => c.close);
  const returns = closes.slice(1).map((price, i) => {
    const prev = closes[i];
    return prev ? (price - prev) / prev : 0;
  });
  const recentVols = ohlcv.slice(-20).map((c) => c.volume);
  const latestVolume = ohlcv[ohlcv.length - 1]?.volume ?? 0;
  const avgVolume = avg(recentVols) ?? 0;
  const price = closes[closes.length - 1];
  const rsiVal = rsi(closes);
  const macdVal = macd(closes);
  const bb = bollingerBands(closes);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const sma200 = closes.length >= 200 ? sma(closes, 200) : null;
  const atr14 = atr(ohlcv, 14);
  return {
    currentPrice: price,
    rsi: rsiVal,
    macd: macdVal,
    bollingerBands: bb,
    ema20,
    ema50,
    sma200,
    atr14,
    momentum3: momentum(closes, 3),
    momentum10: momentum(closes, 10),
    volatility20: stdDev(returns.slice(-20)),
    latestVolume,
    avgVolume,
    volumeRatio: avgVolume > 0 ? latestVolume / avgVolume : null,
  };
}

function generateSignal(ohlcv, signalType, riskTolerance) {
  const closes = ohlcv.map((c) => c.close);
  const ind = analyzeIndicators(ohlcv);
  const {
    currentPrice: price,
    rsi: rsiVal,
    macd: macdVal,
    bollingerBands: bb,
    ema20,
    ema50,
    sma200,
    atr14,
    momentum3,
    momentum10,
    volatility20,
    volumeRatio,
  } = ind;
  const prevMacd = closes.length > 30 ? macd(closes.slice(0, -1)) : { line: null, signal: null, histogram: null };

  let buyScore = 0;
  let sellScore = 0;
  let buyEvidence = 0;
  let sellEvidence = 0;
  const reasons = [];
  const addBuy = (points, reason) => { buyScore += points; buyEvidence += 1; reasons.push(reason); };
  const addSell = (points, reason) => { sellScore += points; sellEvidence += 1; reasons.push(reason); };

  // Regime detection
  const trendBias = ema20 !== null && ema50 !== null ? (ema20 - ema50) / price : 0;
  const strongTrend = Math.abs(trendBias) >= 0.012;
  const regime = strongTrend ? (trendBias > 0 ? 'uptrend' : 'downtrend') : 'range';
  reasons.push(
    regime === 'range'
      ? 'Market regime: ranging - mean reversion signals weighted higher'
      : `Market regime: ${regime} - trend-following signals weighted higher`,
  );

  // RSI
  if (rsiVal !== null) {
    if (regime === 'uptrend') {
      if (rsiVal < 38) addBuy(1.6, `RSI(${rsiVal.toFixed(1)}) pullback in uptrend - dip-buy setup`);
      else if (rsiVal > 78) addSell(1.2, `RSI(${rsiVal.toFixed(1)}) extended in uptrend - short-term exhaustion risk`);
      else reasons.push(`RSI(${rsiVal.toFixed(1)}) healthy for uptrend continuation`);
    } else if (regime === 'downtrend') {
      if (rsiVal > 62) addSell(1.6, `RSI(${rsiVal.toFixed(1)}) bounce in downtrend - sell-the-rally setup`);
      else if (rsiVal < 22) addBuy(1.1, `RSI(${rsiVal.toFixed(1)}) deeply oversold - relief bounce possible`);
      else reasons.push(`RSI(${rsiVal.toFixed(1)}) neutral within downtrend`);
    } else {
      if (rsiVal < 30) addBuy(1.8, `RSI(${rsiVal.toFixed(1)}) oversold in range - bullish mean reversion`);
      else if (rsiVal > 70) addSell(1.8, `RSI(${rsiVal.toFixed(1)}) overbought in range - bearish mean reversion`);
      else reasons.push(`RSI(${rsiVal.toFixed(1)}) neutral in ranging market`);
    }
  }

  // MACD
  if (macdVal.histogram !== null) {
    const histNow = macdVal.histogram;
    const histPrev = prevMacd.histogram;
    if (histNow > 0 && macdVal.line > macdVal.signal) {
      if (histPrev !== null && histPrev <= 0) addBuy(1.9, 'MACD fresh bullish crossover - momentum shift upward');
      else if (histPrev !== null && histNow > histPrev) addBuy(1.4, 'MACD bullish momentum is strengthening');
      else addBuy(1.1, 'MACD remains bullish');
    } else if (histNow < 0 && macdVal.line < macdVal.signal) {
      if (histPrev !== null && histPrev >= 0) addSell(1.9, 'MACD fresh bearish crossover - momentum shift downward');
      else if (histPrev !== null && histNow < histPrev) addSell(1.4, 'MACD bearish momentum is strengthening');
      else addSell(1.1, 'MACD remains bearish');
    } else {
      reasons.push('MACD near equilibrium - weak momentum conviction');
    }
  }

  // Bollinger Bands
  if (bb.lower !== null && bb.middle !== null && bb.upper !== null) {
    const bandWidth = (bb.upper - bb.lower) / bb.middle;
    if (price <= bb.lower) {
      const points = regime === 'downtrend' ? 0.8 : 1.4;
      addBuy(points, `Price touched lower Bollinger Band ($${bb.lower.toFixed(2)}) - downside stretch`);
    } else if (price >= bb.upper) {
      const points = regime === 'uptrend' ? 0.8 : 1.4;
      addSell(points, `Price touched upper Bollinger Band ($${bb.upper.toFixed(2)}) - upside stretch`);
    }
    if (bandWidth < 0.04) {
      reasons.push('Bollinger bandwidth compressed - breakout risk rising, confidence moderated');
      buyScore *= 0.95;
      sellScore *= 0.95;
    }
  }

  // EMA trend
  if (ema20 !== null && ema50 !== null) {
    if (price > ema20 && ema20 > ema50) addBuy(1.5, 'Price above EMA20 > EMA50 - bullish structure intact');
    else if (price < ema20 && ema20 < ema50) addSell(1.5, 'Price below EMA20 < EMA50 - bearish structure intact');
    else reasons.push('EMA structure mixed - trend conviction reduced');
  }
  if (sma200 !== null) {
    if (price > sma200) addBuy(0.7, 'Price above SMA200 - long-term trend support');
    else addSell(0.7, 'Price below SMA200 - long-term trend pressure');
  }

  // Price momentum
  if (momentum3 !== null && momentum10 !== null) {
    if (momentum3 > 0 && momentum10 > 0) addBuy(1.1, 'Short and medium-term momentum aligned upward');
    else if (momentum3 < 0 && momentum10 < 0) addSell(1.1, 'Short and medium-term momentum aligned downward');
    else reasons.push('Momentum mixed across time windows - possible transition phase');
  }

  // Volume
  if (volumeRatio !== null) {
    if (volumeRatio > 1.6) {
      reasons.push(`Volume spike (${volumeRatio.toFixed(2)}x avg) - move conviction higher`);
      if (buyScore > sellScore) buyScore += 0.6;
      else if (sellScore > buyScore) sellScore += 0.6;
    } else if (volumeRatio < 0.75) {
      reasons.push(`Volume below average (${volumeRatio.toFixed(2)}x) - breakout reliability lower`);
      buyScore *= 0.93;
      sellScore *= 0.93;
    }
  }

  // Contradiction penalty when evidence is split
  if (buyScore > 0 && sellScore > 0) {
    const overlap = Math.min(buyScore, sellScore) * 0.35;
    buyScore -= overlap;
    sellScore -= overlap;
    reasons.push('Bullish and bearish evidence both present - applied contradiction penalty');
  }

  // Threshold
  const thresholds = { conservative: 4.9, moderate: 3.6, aggressive: 2.6 };
  let threshold = thresholds[riskTolerance] || 3.6;
  if (regime === 'range') threshold += 0.2;
  if (volatility20 !== null && volatility20 > 0.025) threshold += 0.2;

  let signal, confidence;
  const edge = Math.abs(buyScore - sellScore);
  const dominantScore = Math.max(buyScore, sellScore);
  if (buyScore >= threshold && buyScore > sellScore && edge >= 0.9) {
    signal = 'BUY';
  } else if (sellScore >= threshold && sellScore > buyScore && edge >= 0.9) {
    signal = 'SELL';
  } else {
    signal = 'HOLD';
    reasons.push('Insufficient directional edge after confluence check - wait for confirmation');
  }

  if (signal === 'HOLD') {
    confidence = clamp(42 + edge * 6, 40, 65);
  } else {
    const evidenceCount = signal === 'BUY' ? buyEvidence : sellEvidence;
    confidence = clamp(
      dominantScore * 13 + edge * 16 + evidenceCount * 2,
      55,
      95,
    );
  }

  // Targets
  const targets = { scalp: [0.01, 0.02, 0.005], swing: [0.03, 0.08, 0.015], position: [0.10, 0.20, 0.03] };
  const [tp1Pct, tp2Pct, slPct] = targets[signalType] || targets.swing;
  const dir = signal === 'SELL' ? -1 : 1;
  const atrPct = atr14 !== null ? atr14 / price : null;
  const entryPadPct = clamp(atrPct !== null ? atrPct * 0.3 : 0.002, 0.0015, 0.008);
  const dynamicSlPct = clamp(
    atrPct !== null ? Math.max(slPct, atrPct * 1.1) : slPct,
    slPct * 0.85,
    slPct * 1.9,
  );
  const entryLow = +(price * (1 - entryPadPct)).toFixed(2);
  const entryHigh = +(price * (1 + entryPadPct)).toFixed(2);
  const tp1 = +(price * (1 + dir * tp1Pct)).toFixed(2);
  const tp2 = +(price * (1 + dir * tp2Pct)).toFixed(2);
  const sl = +(price * (1 - dir * dynamicSlPct)).toFixed(2);
  const riskReward = signal !== 'HOLD' ? +((Math.abs(tp2 - price) / Math.abs(price - sl)) || 0).toFixed(2) : 0;

  return {
    signal,
    confidence: +confidence.toFixed(1),
    currentPrice: +price.toFixed(2),
    entryRange: { low: entryLow, high: entryHigh },
    takeProfit1: tp1,
    takeProfit1Pct: +(dir * tp1Pct * 100).toFixed(2),
    takeProfit2: tp2,
    takeProfit2Pct: +(dir * tp2Pct * 100).toFixed(2),
    stopLoss: sl,
    stopLossPct: +(-dir * dynamicSlPct * 100).toFixed(2),
    riskReward,
    reasons,
    indicators: {
      rsi: rsiVal !== null ? +rsiVal.toFixed(2) : null,
      macd: {
        line: macdVal.line !== null ? +macdVal.line.toFixed(4) : null,
        signal: macdVal.signal !== null ? +macdVal.signal.toFixed(4) : null,
        histogram: macdVal.histogram !== null ? +macdVal.histogram.toFixed(4) : null,
      },
      bollingerBands: {
        upper: bb.upper !== null ? +bb.upper.toFixed(2) : null,
        middle: bb.middle !== null ? +bb.middle.toFixed(2) : null,
        lower: bb.lower !== null ? +bb.lower.toFixed(2) : null,
      },
      ema20: ema20 !== null ? +ema20.toFixed(2) : null,
      ema50: ema50 !== null ? +ema50.toFixed(2) : null,
      sma200: ind.sma200 !== null ? +ind.sma200.toFixed(2) : null,
      atr14: atr14 !== null ? +atr14.toFixed(4) : null,
      momentum3: momentum3 !== null ? +(momentum3 * 100).toFixed(2) : null,
      momentum10: momentum10 !== null ? +(momentum10 * 100).toFixed(2) : null,
      volatility20: volatility20 !== null ? +(volatility20 * 100).toFixed(2) : null,
      volumeRatio: volumeRatio !== null ? +volumeRatio.toFixed(2) : null,
    },
    timestamp: new Date().toISOString(),
    dataSource: 'live',
  };
}

module.exports = { fetchOHLCV, generateSignal, SYMBOL_MAP };
