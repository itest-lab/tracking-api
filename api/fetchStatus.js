// pages/api/fetchStatus.js

import axios from 'axios';
import * as cheerio from 'cheerio';

const TRACK123_API_URL    = 'https://api.track123.com/gateway/open-api/tk/v2/track/query';
const TRACK123_API_SECRET = process.env.TRACK123_API_SECRET;

// スクレイピング対応：佐川急便・ヤマト運輸
const configs = {
  sagawa: {
    url: t => `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${t}`,
    extract(html) {
      const $ = cheerio.load(html);
      let status = $('span.state').first().text().trim();
      if (status === '該当なし') status = '伝票番号未登録';
      let time = '';
      $('dl.okurijo_info dt').each((i, el) => {
        if ($(el).text().includes('配達完了日')) {
          time = $(el).next('dd').text().trim()
            .replace(/年|月/g, '/')
            .replace(/日/, '')
            .replace(/時/, ':')
            .replace(/分/, '');
          return false;
        }
      });
      return { status, time };
    }
  },
  yamato: {
    options: t => ({
      method: 'POST',
      url: 'https://toi.kuronekoyamato.co.jp/cgi-bin/tneko',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `number01=${encodeURIComponent(t)}`
    }),
    extract(html) {
      const $ = cheerio.load(html);
      // 明細テーブルの2行目に荷物情報がある想定
      const $row = $('#InqScrTbl tr').eq(1);
      let date   = $row.find('td').eq(0).text().trim();
      let status = $row.find('td').eq(1).text().trim();
      if (!status) status = '伝票番号未登録';
      return { status, time: date };
    }
  }
};

// Track123 フォールバック対応：福山通運・西濃運輸・トナミ運輸・飛騨運輸
const track123Mapping = {
  fukuyama: 'fukuyama-transporting',
  seino:    'seino-express',
  tonami:   'tonami-transporting',
  hida:     'hida-transporting'
};

export default async function handler(req, res) {
  // CORS 設定
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { carrier, tracking } = req.query;
  if (!carrier || !tracking) {
    res.status(400).json({ error: 'carrier と tracking の両パラメータが必要です' });
    return;
  }

  // 1) スクレイピング対応
  const config = configs[carrier];
  if (config) {
    try {
      let html;
      if (config.options) {
        const response = await axios(config.options(tracking));
        html = response.data;
      } else {
        const response = await axios.get(config.url(tracking));
        html = response.data;
      }
      const result = config.extract(html);
      res.status(200).json(result);
    } catch (err) {
      console.error('スクレイピングエラー:', err);
      res.status(500).json({ error: '配送状況の取得に失敗しました（スクレイピング）' });
    }
    return;
  }

  // 2) Track123 API フォールバック対応
  const tkCode = track123Mapping[carrier];
  if (tkCode) {
    try {
      const body = {
        trackNos:   [tracking],
        courierCode: tkCode
      };
      const apiRes = await axios.post(
        TRACK123_API_URL,
        body,
        { headers: { 'Track123-Api-Secret': TRACK123_API_SECRET } }
      );
      const accepted = apiRes.data.data.accepted.content[0];
      // Track123 のレスポンス構造に合わせて status/time を取得
      const status = accepted.transitStatus || accepted.trackingStatus || '不明';
      const time   = accepted.lastTrackingTime || accepted.localLogisticsInfo?.trackingDetails?.[0]?.eventTime || '';
      res.status(200).json({ status, time });
    } catch (err) {
      console.error('Track123 API エラー:', err.response?.data || err.message);
      res.status(500).json({ error: '配送状況の取得に失敗しました（Track123 API）' });
    }
    return;
  }

  // 未対応業者
  res.status(404).json({ error: `${carrier} は未対応の配送業者です` });
}
