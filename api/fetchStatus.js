// pages/api/fetchStatus.js

import axios from 'axios';
import * as cheerio from 'cheerio';

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

  // 各社のスクレイピング定義
  const configs = {
    // 佐川急便
    sagawa: {
      url: t => `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${encodeURIComponent(t)}`,
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
    // ヤマト運輸（JIZEN版）
    yamato: {
      url: t => `https://jizen.kuronekoyamato.co.jp/jizen/servlet/crjz.b.NQ0010?id=${encodeURIComponent(t)}`, // :contentReference[oaicite:0]{index=0}
      extract(html) {
        const $ = cheerio.load(html);
        // 実際のテーブル構造に合わせて調整してください
        const $rows = $('table').find('tr');
        const firstDataRow = $rows.eq(1).find('td');
        const date   = firstDataRow.eq(0).text().trim();
        const status = firstDataRow.eq(1).text().trim() || '伝票番号未登録';
        return { status, time: date };
      }
    },
    // 福山通運
    fukuyama: {
      url: t => `https://corp.fukutsu.co.jp/situation/tracking_no_hunt/${encodeURIComponent(t)}`, // :contentReference[oaicite:1]{index=1}
      extract(html) {
        const $ = cheerio.load(html);
        // 例：<dl class="tracking_info"><dt>現在状況</dt><dd>～</dd>…
        const status = $('dl.tracking_info dt:contains("現在状況")').next('dd').text().trim();
        const time   = $('dl.tracking_info dt:contains("配達完了日")').next('dd').text().trim()
                          .replace(/年|月/g, '/')
                          .replace(/日/, '')
                          .replace(/時/, ':')
                          .replace(/分/, '');
        return { status, time };
      }
    },
    // 西濃運輸
    seino: {
      url: t => `https://track.seino.co.jp/cgi-bin/gnpquery.pgm?GNPNO1=${encodeURIComponent(t)}`, // :contentReference[oaicite:2]{index=2}
      extract(html) {
        const $ = cheerio.load(html);
        // 例：ヘッダー行があるテーブルから 2 行目を取得
        const $table = $('table').filter((i, el) => $(el).find('th').length > 0).first();
        const $row   = $table.find('tr').eq(1);
        const date   = $row.find('td').eq(0).text().trim();
        const status = $row.find('td').eq(1).text().trim() || '伝票番号未登録';
        return { status, time: date };
      }
    },
    // トナミ運輸
    tonami: {
      url: t => `https://trc1.tonami.co.jp/trc/search3/excSearch3?AWB_NO=${encodeURIComponent(t)}`, // :contentReference[oaicite:3]{index=3}
      extract(html) {
        const $ = cheerio.load(html);
        // 例：結果テーブルの ID やクラスを確認して置き換えてください
        const $row = $('table#tblResult').find('tr').eq(1);
        const date   = $row.find('td').eq(0).text().trim();
        const status = $row.find('td').eq(2).text().trim();
        return { status, time: date };
      }
    },
    // 飛騨運輸（モバイル版イメージ）
    hida: {
      url: t => `https://www.hida-unyu.co.jp/WP_HIDAUNYU_WKSHO_GUEST/awbnoQuery.do?awbno=${encodeURIComponent(t)}`, // :contentReference[oaicite:4]{index=4}
      extract(html) {
        const $ = cheerio.load(html);
        // mobile 版 HTML 構造に合わせて調整してください
        const status = $('div.result-status').text().trim();
        const time   = $('div.result-time').text().trim();
        return { status, time };
      }
    }
  };

  const cfg = configs[carrier];
  if (!cfg) {
    res.status(404).json({ error: `${carrier} は未対応の配送業者です` });
    return;
  }

  try {
    const response = await axios.get(cfg.url(tracking));
    const result = cfg.extract(response.data);
    res.status(200).json(result);
  } catch (err) {
    console.error('fetchStatus error:', err);
    res.status(500).json({ error: '配送状況の取得に失敗しました' });
  }
}
