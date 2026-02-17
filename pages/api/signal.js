import {
  normalizeTradingSymbol,
  fetchOHLCV,
  fetchFuturesContext,
  fetchCatalystWatch,
  generateSignal,
  SYMBOL_MAP,
} from '../../lib/signalGenerator';

const SUPPORTED_TIMEFRAMES = ['15m', '1h', '4h', '1d'];
const SUPPORTED_SIGNAL_TYPES = ['scalp', 'intraday', 'swing'];
const SUPPORTED_RISK_TOLERANCE = ['conservative', 'moderate', 'aggressive'];

function pickAllowed(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function buildEmptyFuturesContext() {
  return {
    fundingRate: { current: null, annualizedPct: null, nextFundingTime: null },
    openInterest: { latest: null, changePct: null },
    longShortRatio: { ratio: null, changePct: null },
    source: 'fallback',
  };
}

function buildEmptyCatalystWatch() {
  return {
    sentimentScore: 0,
    trendBoost: 0,
    combinedScore: 0,
    sentimentLabel: 'Neutral',
    symbolTrendingRank: null,
    catalysts: [],
    trendingTopics: [],
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const params = req.method === 'POST' ? req.body : req.query;
  const {
    symbol = 'BTCUSDT',
    geckoId = '',
    symbolName = '',
    symbolBase = '',
    timeframe = '4h',
    signalType = 'swing',
    riskTolerance = 'moderate',
  } = params;
  const normalizedSymbol = normalizeTradingSymbol(symbol || symbolBase || 'BTCUSDT');
  const safeTimeframe = pickAllowed(String(timeframe || '4h'), SUPPORTED_TIMEFRAMES, '4h');
  const safeSignalType = pickAllowed(String(signalType || 'swing'), SUPPORTED_SIGNAL_TYPES, 'swing');
  const safeRiskTolerance = pickAllowed(String(riskTolerance || 'moderate'), SUPPORTED_RISK_TOLERANCE, 'moderate');
  const warnings = [];

  if (safeTimeframe !== timeframe) warnings.push('Invalid timeframe normalized to 4h');
  if (safeSignalType !== signalType) warnings.push('Invalid signalType normalized to swing');
  if (safeRiskTolerance !== riskTolerance) warnings.push('Invalid riskTolerance normalized to moderate');

  try {
    const [ohlcvResult, futuresContextResult, catalystWatchResult] = await Promise.allSettled([
      fetchOHLCV(normalizedSymbol, safeTimeframe, 120, { geckoId }),
      fetchFuturesContext(normalizedSymbol, safeTimeframe, { geckoId }),
      fetchCatalystWatch(normalizedSymbol, {
        geckoId,
        coinName: symbolName,
        coinSymbol: symbolBase || normalizedSymbol.replace(/USDT$/, ''),
      }),
    ]);

    let ohlcv = ohlcvResult.status === 'fulfilled' && Array.isArray(ohlcvResult.value)
      ? ohlcvResult.value
      : [];
    if (!ohlcv.length) {
      warnings.push('Primary OHLCV unavailable, switched to demo fallback');
      ohlcv = await fetchOHLCV('BTCUSDT', safeTimeframe, 120, { geckoId: 'bitcoin' });
    }

    const futuresContext = futuresContextResult.status === 'fulfilled'
      ? futuresContextResult.value
      : buildEmptyFuturesContext();
    if (futuresContextResult.status !== 'fulfilled') {
      warnings.push('Futures context unavailable, served neutral values');
    }

    const catalystWatch = catalystWatchResult.status === 'fulfilled'
      ? catalystWatchResult.value
      : buildEmptyCatalystWatch();
    if (catalystWatchResult.status !== 'fulfilled') {
      warnings.push('Catalyst watch unavailable, served neutral values');
    }

    if (!ohlcv.length) {
      warnings.push('OHLCV fallback still unavailable, generated last-resort demo');
      ohlcv = await fetchOHLCV('BTCUSDT', '4h', 120, { geckoId: 'bitcoin' });
    }

    const result = generateSignal(ohlcv, safeSignalType, safeRiskTolerance, {
      futuresContext,
      catalystWatch,
    });
    const knownCoin = SYMBOL_MAP[normalizedSymbol];
    result.symbol = normalizedSymbol;
    result.symbolName = symbolName || knownCoin?.name || (symbolBase || normalizedSymbol.replace(/USDT$/, '')).toUpperCase();
    result.geckoId = geckoId || knownCoin?.geckoId || null;
    result.timeframe = safeTimeframe;
    result.signalType = safeSignalType;
    result.riskTolerance = safeRiskTolerance;
    result.degraded = warnings.length > 0;
    result.warnings = warnings;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(result);
  } catch (err) {
    try {
      const fallbackOHLCV = await fetchOHLCV('BTCUSDT', '4h', 120, { geckoId: 'bitcoin' });
      const fallback = generateSignal(fallbackOHLCV, 'swing', 'moderate', {
        futuresContext: buildEmptyFuturesContext(),
        catalystWatch: buildEmptyCatalystWatch(),
      });
      fallback.symbol = 'BTCUSDT';
      fallback.symbolName = 'Bitcoin';
      fallback.geckoId = 'bitcoin';
      fallback.timeframe = '4h';
      fallback.signalType = 'swing';
      fallback.riskTolerance = 'moderate';
      fallback.degraded = true;
      fallback.warnings = ['Signal generation failed, fallback payload returned'];
      fallback.error = err.message;
      return res.status(200).json(fallback);
    } catch {
      return res.status(200).json({
        signal: 'HOLD',
        confidence: 0,
        symbol: 'BTCUSDT',
        symbolName: 'Bitcoin',
        geckoId: 'bitcoin',
        timeframe: '4h',
        signalType: 'swing',
        riskTolerance: 'moderate',
        reasons: ['Temporary API issue, no analysis data available.'],
        indicators: {
          rsi: null,
          macd: { line: null, signal: null, histogram: null },
          bollingerBands: { upper: null, middle: null, lower: null },
          ema20: null,
          ema50: null,
          sma200: null,
          atr14: null,
          momentum3: null,
          momentum10: null,
          volatility20: null,
          volumeRatio: null,
        },
        currentPrice: null,
        entryRange: { low: null, high: null },
        takeProfit1: null,
        takeProfit1Pct: null,
        takeProfit2: null,
        takeProfit2Pct: null,
        stopLoss: null,
        stopLossPct: null,
        riskReward: null,
        futuresContext: buildEmptyFuturesContext(),
        catalystWatch: buildEmptyCatalystWatch(),
        liquidityHeatmap: null,
        liquidationRiskMeter: null,
        breakoutFakeoutDetector: null,
        signalQuality: null,
        marketType: 'fallback',
        dataSource: 'fallback',
        degraded: true,
        warnings: ['Signal endpoint degraded mode response'],
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
