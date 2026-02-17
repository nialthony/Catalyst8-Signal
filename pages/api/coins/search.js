import { searchCoins } from '../../../lib/signalGenerator';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { q = '', query = '', limit = '10' } = req.query;
  const keyword = String(q || query || '').trim();
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 10));

  if (!keyword) {
    return res.status(200).json({ coins: [] });
  }

  try {
    const coins = await searchCoins(keyword, safeLimit);
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(200).json({ coins });
  } catch (err) {
    return res.status(500).json({ error: 'Coin search failed', details: err.message });
  }
}
