// api/fetchStatus.js
import axios from "axios";
import * as cheerio from "cheerio";

const configs = {
  sagawa: {
    url: t => https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${t},
    extract(html) {
      const $ = cheerio.load(html);
      let status = $("span.state").first().text().trim();
      if (status === "該当なし") status = "伝票番号未登録";
      let time = "";
      $("dl.okurijo_info dt").each((i, el) => {
        if ($(el).text().includes("配達完了日")) {
          time = $(el)
            .next("dd")
            .text()
            .trim()
            .replace(/年|月/g, "/")
            .replace(/日/, "")
            .replace("時", ":")
            .replace("分", "");
          return false;
        }
      });
      return { status, time };
    }
  },
  yamato: {
    options: t => ({
      method: "POST",
      url: "https://toi.kuronekoyamato.co.jp/cgi-bin/tneko",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer":      "https://toi.kuronekoyamato.co.jp/cgi-bin/tneko",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/115.0.0.0 Safari/537.36"
      },
      data: new URLSearchParams({ number00: "1", number01: t }).toString()
    }),
    extract(html) {
      const $ = cheerio.load(html);
      // 生のステータステキスト（例："配達完了"）
      const raw = $('h4.tracking-invoice-block-state-title')
        .first()
        .text()
        .trim();
  
      // 配達完了日時を time にだけ格納
      let time = "";
      $('div.tracking-invoice-block-detail ol li').each((i, li) => {
        if ($(li).find("div.item").text().includes("配達完了")) {
          time = $(li).find("div.date").text().trim();
          return false;
        }
      });
      if (!time) {
        const m = $('div.tracking-invoice-block-summary')
          .first()
          .text()
          .match(/([0-9]{1,2}月[0-9]{1,2}日\s*[0-9]{1,2}[:：][0-9]{2})/);
        if (m) time = m[0];
      }
      
      const status = raw;
      return { status, time };
    }
  }
  fukutsu: {
    url: t => https://corp.fukutsu.co.jp/situation/tracking_no_hunt/${t},
    extract(html) {
      const $ = cheerio.load(html);
      let status = $("strong.redbold").first().text().trim();
      let time = "";
      if (status === "配達完了です") {
        status = "配達完了";
        const arr = [...html.matchAll(/<strong>([^<]+)<\/strong>/g)];
        if (arr[4]) time = arr[4][1].trim();
      } else if (status === "該当データはありません。") {
        status = "伝票番号未登録";
      }
      return { status, time };
    }
  },
  seino: {
    url: t => https://track.seino.co.jp/cgi-bin/gnpquery.pgm?GNPNO1=${t},
    extract(html) {
      const $ = cheerio.load(html);
      let status = $('input#haitatsuJokyo0').attr("value")?.trim() || "";
      let time = "";
      if (/配達済み/.test(status)) {
        status = "配達完了";
        time = $('input#haitatsuTenshoDate0').attr("value")?.trim() || "";
      } else if (/未登録|誤り/.test(status)) {
        status = "伝票番号未登録";
      }
      return { status, time };
    }
  },
  tonami: {
    url: t => https://trc1.tonami.co.jp/trc/search3/excSearch3?id[0]=${t},
    extract(html) {
      const $ = cheerio.load(html);
      let cnt = 0, secondLatest = "";
      $("th").each((i, el) => {
        if ($(el).text().trim() === "最新状況") {
          if (++cnt === 2) {
            secondLatest = $(el).parent().find("td").first().text().trim();
            return false;
          }
        }
      });
      let firstDelivery = "";
      $("table.statusTable tr").each((i, tr) => {
        if ($(tr).find("th").first().text().trim() === "配完") {
          firstDelivery = $(tr).find("td").first().text().trim();
          return false;
        }
      });
      const status = secondLatest || firstDelivery || "情報取得できませんでした";
      const time   = firstDelivery;
      return { status, time };
    }
  }
  hida: {
    // PC版の URL に ?okurijoNo=伝票番号 を付与
    url: t => `http://www.hida-unyu.co.jp/tsuiseki/sho100.html?okurijoNo=${t}`,
    extract(html) {
      const $ = cheerio.load(html);

      // ステータスを取得（site 側のクラス名は要確認）
      let status = $("span.status, td.status").first().text().trim();
      if (!status || /該当なし/.test(status)) {
        status = "伝票番号未登録";
      }

      // 時刻を取得（例: 配達完了日時）
      let time = $("td.time, .date, .delivery-time").first().text().trim();

      return { status, time };
    }
  }
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).send("Method Not Allowed");
  }

  // JSON body
  const { carrier, tracking } = req.body || {};
  if (!carrier || !tracking || !configs[carrier]) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res
      .status(400)
      .json({ status: "Invalid carrier/tracking", time: "" });
  }

  try {
    const cfg = configs[carrier];
    const resp = cfg.options
      ? await axios(cfg.options(tracking))
      : await axios.get(cfg.url(tracking));
    const html = resp.data;
    const result = cfg.extract(html);

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(result);

  } catch (e) {
    console.error(e);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res
      .status(500)
      .json({ status: "Fetch error", time: "" });
  }
}
