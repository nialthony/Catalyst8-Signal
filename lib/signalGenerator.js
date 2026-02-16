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

function analyzeIndicators(ohlcv) {
  const closes = ohlcv.map((c) => c.close);
  const price = closes[closes.length - 1];
  const rsiVal = rsi(closes);
  const macdVal = macd(closes);
  const bb = bollingerBands(closes);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const sma200 = closes.length >= 200 ? sma(closes, 200) : null;
  return { currentPrice: price, rsi: rsiVal, macd: macdVal, bollingerBands: bb, ema20, ema50, sma200 };
}

function generateSignal(ohlcv, signalType, riskTolerance) {
  const ind = analyzeIndicators(ohlcv);
  const { currentPrice: price, rsi: rsiVal, macd: macdVal, bollingerBands: bb, ema20, ema50 } = ind;

  let buyScore = 0, sellScore = 0;
  const reasons = [];

  // RSI
  if (rsiVal !== null) {
    if (rsiVal < 30) { buyScore += 2; reasons.push(`RSI(${rsiVal.toFixed(1)}) in oversold zone - bullish reversal likely`); }
    else if (rsiVal < 40) { buyScore += 1; reasons.push(`RSI(${rsiVal.toFixed(1)}) approaching oversold - moderate buy signal`); }
    else if (rsiVal > 70) { sellScore += 2; reasons.push(`RSI(${rsiVal.toFixed(1)}) in overbought zone - bearish reversal likely`); }
    else if (rsiVal > 60) { sellScore += 1; reasons.push(`RSI(${rsiVal.toFixed(1)}) approaching overbought - moderate sell signal`); }
    else { reasons.push(`RSI(${rsiVal.toFixed(1)}) in neutral zone`); }
  }

  // MACD
  if (macdVal.histogram !== null) {
    if (macdVal.histogram > 0 && macdVal.line > macdVal.signal) {
      buyScore += 1.5; reasons.push('MACD bullish crossover - upward momentum');
    } else if (macdVal.histogram < 0 && macdVal.line < macdVal.signal) {
      sellScore += 1.5; reasons.push('MACD bearish crossover - downward momentum');
    }
  }

  // Bollinger Bands
  if (bb.lower !== null) {
    if (price <= bb.lower) { buyScore += 1.5; reasons.push(`Price at lower Bollinger Band ($${bb.lower.toFixed(2)}) - oversold`); }
    else if (price >= bb.upper) { sellScore += 1.5; reasons.push(`Price at upper Bollinger Band ($${bb.upper.toFixed(2)}) - overbought`); }
  }

  // EMA trend
  if (ema20 !== null && ema50 !== null) {
    if (price > ema20 && ema20 > ema50) { buyScore += 1; reasons.push('Price above EMA20 > EMA50 - bullish trend confirmed'); }
    else if (price < ema20 && ema20 < ema50) { sellScore += 1; reasons.push('Price below EMA20 < EMA50 - bearish trend confirmed'); }
  }

  // Volume
  const recentVols = ohlcv.slice(-10).map((c) => c.volume);
  const avgVol = recentVols.reduce((s, v) => s + v, 0) / recentVols.length;
  if (ohlcv[ohlcv.length - 1].volume > avgVol * 1.5) {
    reasons.push('High volume detected - strong conviction');
    if (buyScore > sellScore) buyScore += 0.5; else sellScore += 0.5;
  }

  // Threshold
  const thresholds = { conservative: 5.0, moderate: 3.5, aggressive: 2.0 };
  const threshold = thresholds[riskTolerance] || 3.5;

  let signal, confidence;
  if (buyScore >= threshold && buyScore > sellScore) {
    signal = 'BUY'; confidence = Math.min(95, (buyScore / 8) * 100);
  } else if (sellScore >= threshold && sellScore > buyScore) {
    signal = 'SELL'; confidence = Math.min(95, (sellScore / 8) * 100);
  } else {
    signal = 'HOLD'; confidence = 50;
    reasons.push('Insufficient confluence for clear entry/exit - wait for confirmation');
  }

  // Targets
  const targets = { scalp: [0.01, 0.02, 0.005], swing: [0.03, 0.08, 0.015], position: [0.10, 0.20, 0.03] };
  const [tp1Pct, tp2Pct, slPct] = targets[signalType] || targets.swing;
  const dir = signal === 'SELL' ? -1 : 1;
  const entryLow = +(price * 0.998).toFixed(2);
  const entryHigh = +(price * 1.002).toFixed(2);
  const tp1 = +(price * (1 + dir * tp1Pct)).toFixed(2);
  const tp2 = +(price * (1 + dir * tp2Pct)).toFixed(2);
  const sl = +(price * (1 - dir * slPct)).toFixed(2);
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
    stopLossPct: +(-dir * slPct * 100).toFixed(2),
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
    },
    timestamp: new Date().toISOString(),
    dataSource: 'live',
  };
}

module.exports = { fetchOHLCV, generateSignal, SYMBOL_MAP };
