import express from "express";
import cors from "cors";
import axios from "axios";
import * as cheerio from "cheerio";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  const ajaxClient = axios.create({
    baseURL: "https://anikoto.cz",
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://anikoto.cz",
    },
  });

  const client = axios.create({
    baseURL: "https://anikoto.cz",
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  function extractAnimeList(html: string, selector: string = ".item, .flw-item") {
    const $ = cheerio.load(html);
    const results: any[] = [];
    
    $(selector).each((_, el) => {
        const url = $(el).find(".name").attr("href") || $(el).find("a").attr("href") || "";
        const id = url.replace(/.*?\/watch\//, "").replace(/\/ep-.*$/, "").replace(/\/$/, "");
        if (!id) return;

        let sub = $(el).find(".ep-status.sub").text().trim() || null;
        let dub = $(el).find(".ep-status.dub").text().trim() || null;
        let episodes = $(el).find(".ep-status.total").text().trim() || null;
        
        if(sub) sub = sub.replace(/\\D+/g, '');
        if(dub) dub = dub.replace(/\\D+/g, '');
        if(episodes) episodes = episodes.replace(/\\D+/g, '');
        
        results.push({
          id,
          title: $(el).find(".name").text().trim() || $(el).find(".film-name").text().trim() || $(el).find(".dynamic-name").text().trim() || $(el).find("img").attr("alt") || "",
          image: $(el).find("img").attr("data-src") || $(el).find("img").attr("src") || "",
          type: $(el).find(".meta .right").text().trim() || $(el).find(".meta .dot").first().text().trim() || null,
          sub,
          dub,
          episodes
        });
    });
    return results;
  }

  async function getEpisodesData(animeId: string) {
    const { data: watchData } = await client.get(`/watch/${animeId}`);
    const $ = cheerio.load(watchData);
    const numericId = $("[data-id]").first().attr("data-id");
    
    if (!numericId) throw new Error("Could not find numeric ID");

    const resp = await ajaxClient.get(`/ajax/episode/list/${numericId}`, {
      headers: { Referer: `https://anikoto.cz/watch/${animeId}` }
    });
    
    const html = resp.data.result;
    const $ep = cheerio.load(html);
    const episodes: any[] = [];
    
    $ep("a.ep-item").each((_, el) => {
      const epNum = parseInt($ep(el).attr("data-num") || "0", 10);
      let epTitle = $ep(el).find(".ep-name, .d-title").text().trim() || $ep(el).attr("title");
      if(!epTitle) epTitle = `Episode ${epNum}`;
      
      episodes.push({
        num: epNum,
        title: epTitle,
        ids: $ep(el).attr("data-ids"),
        slug: $ep(el).attr("data-slug"),
        malId: parseInt($ep(el).attr("data-mal") || "0", 10) || null,
        isSub: $ep(el).attr("data-sub") === "1",
        isDub: $ep(el).attr("data-dub") === "1",
        isFiller: !!$ep(el).attr("class")?.includes("filler") || !!$ep(el).parent().attr("class")?.includes("filler"),
      });
    });
    
    if (episodes.length === 0) {
      $ep("a[data-ids][data-num]").each((_, el) => {
        episodes.push({
          num: parseInt($ep(el).attr("data-num") || "0", 10),
          title: $ep(el).find(".ep-name, .d-title").text().trim() || $ep(el).parent().attr("title") || `Episode ${$ep(el).attr("data-num")}`,
          ids: $ep(el).attr("data-ids"),
          slug: $ep(el).attr("data-slug"),
          malId: parseInt($ep(el).attr("data-mal") || "0", 10) || null,
          isSub: $ep(el).attr("data-sub") === "1",
          isDub: $ep(el).attr("data-dub") === "1",
          isFiller: !!$ep(el).attr("class")?.includes("filler") || !!$ep(el).parent().attr("class")?.includes("filler"),
        });
      });
    }
    
    return { numericId, episodes };
  }

  function mapServerName(name: string): string {
    const lowerName = name.toLowerCase().trim();
    if (lowerName.includes("vidcloud") || lowerName.includes("megacloud") || lowerName.includes("rabbitstream")) return "hd-1";
    if (lowerName.includes("vidstream") || lowerName.includes("megaplay")) return "hd-2";
    if (lowerName.includes("vidplay")) return "hd-4";
    if (lowerName.includes("mycloud")) return "hd-5";
    if (lowerName.includes("filemoon")) return "hd-6";
    if (lowerName.includes("hd-") || lowerName.includes("hd ")) return "hd-3";
    return "hd-3";
  }

  async function resolveAnime(queryId: string) {
    let searchQueries: string[] = [queryId];
    let isAnilistId = /^\d+$/.test(queryId);

    if (isAnilistId) {
      try {
        const q = `query($id:Int){Media(id:$id,type:ANIME){title{romaji english}}}`;
        const gqResp = await axios.post("https://graphql.anilist.co", { query: q, variables: { id: parseInt(queryId, 10) } });
        const titles = gqResp.data?.data?.Media?.title;
        searchQueries = [];
        if (titles?.english) searchQueries.push(titles.english);
        if (titles?.romaji) searchQueries.push(titles.romaji);
        if (searchQueries.length === 0) searchQueries.push(queryId);
      } catch(e) {
        console.error("Anilist lookup failed", e);
      }
    }

    let matchedAnime: any = null;

    for (const sq of searchQueries) {
      const resp = await client.get("/filter", { params: { keyword: sq } });
      const results = extractAnimeList(resp.data);
      if (results.length > 0) {
        const lowerSq = sq.toLowerCase();
        matchedAnime = results.find(r => r.title.toLowerCase() === lowerSq);
        if (matchedAnime) break;
      }
    }

    if (!matchedAnime) {
      // Fallback to the first result of the first query if exact match fails
      const resp = await client.get("/filter", { params: { keyword: searchQueries[0] } });
      const results = extractAnimeList(resp.data);
      if (results.length > 0) {
        matchedAnime = results[0];
      }
    }

    return matchedAnime;
  }

  app.get("/api/search", async (req, res) => {
    const keyword = req.query.keyword as string;
    if (!keyword) {
      res.status(400).json({ error: "Keyword required" });
      return;
    }
    try {
      const resp = await client.get("/filter", { params: { keyword } });
      const results = extractAnimeList(resp.data);
      res.json({ success: true, data: results });
    } catch (e: any) {
      console.error("Search error:", e.message);
      res.status(500).json({ success: false, error: "Failed to scrape search results", details: e.message });
    }
  });

  app.get("/api/episodes", async (req, res) => {
    const queryId = req.query.id as string;
    if (!queryId) {
      res.status(400).json({ success: false, error: "Anime ID or Title is required in 'id' query parameter" });
      return;
    }

    try {
      const matchedAnime = await resolveAnime(queryId);

      if (!matchedAnime) {
        res.status(404).json({ success: false, error: "Anime not found on anikoto.cz" });
        return;
      }

      const animeId = matchedAnime.id;
      const { episodes } = await getEpisodesData(animeId);
      const formattedEpisodes = episodes.map(e => ({
          num: e.num,
          title: e.title,
          slug: e.slug,
          isSub: e.isSub,
          isDub: e.isDub,
          isFiller: e.isFiller
      }));
      res.json({ success: true, animeTitle: matchedAnime.title, animeId: animeId, data: formattedEpisodes });
    } catch (e: any) {
      console.error("Episodes error:", e.message);
      res.status(500).json({ success: false, error: "Failed to scrape episodes", details: e.message });
    }
  });

  app.get("/api/servers", async (req, res) => {
    const { id: queryId, ep: epSlug } = req.query as { id: string, ep: string };
    if (!queryId || !epSlug) {
      res.status(400).json({ error: "Missing id or ep parameter" });
      return;
    }
    try {
      const matchedAnime = await resolveAnime(queryId);
      if (!matchedAnime) {
        res.status(404).json({ success: false, error: "Anime not found on anikoto.cz" });
        return;
      }

      const animeId = matchedAnime.id;
      const { episodes } = await getEpisodesData(animeId);
      const episode = episodes.find(e => e.slug === epSlug);
      
      if (!episode) {
        res.status(404).json({ error: "Episode not found" });
        return;
      }

      const [animeNumId, epsNum] = episode.ids.split("&eps=");
      const resp = await ajaxClient.get(`/ajax/server/list`, {
        params: { servers: animeNumId, eps: epsNum },
        headers: { Referer: `https://anikoto.cz/watch/${animeId}` }
      });
      
      const html = resp.data.result || "";
      const $ = cheerio.load(html);
      const servers: any[] = [];
      
      $(".type li[data-link-id]").each((_, el) => {
        const name = $(el).text().trim();
        const mappedName = mapServerName(name);

        servers.push({
          type: $(el).closest(".type").attr("data-type"),
          name: name,
          serverId: mappedName
        });
      });
      
      res.json({ success: true, animeTitle: matchedAnime.title, animeId: animeId, data: servers });
    } catch (e: any) {
      console.error("Servers error:", e.message);
      res.status(500).json({ success: false, error: "Failed to scrape servers", details: e.message });
    }
  });

  app.get("/api/stream", async (req, res) => {
    const { id: queryId, ep: epSlug, server: serverName, type = 'sub' } = req.query as { id: string, ep: string, server: string, type: string };
    if (!queryId || !epSlug || !serverName) {
      res.status(400).json({ error: "Missing required query parameters" });
      return;
    }
    try {
      const matchedAnime = await resolveAnime(queryId);
      if (!matchedAnime) {
        res.status(404).json({ success: false, error: "Anime not found on anikoto.cz" });
        return;
      }

      const animeId = matchedAnime.id;
      const { episodes } = await getEpisodesData(animeId);
      const episode = episodes.find(e => e.slug === epSlug);
      if (!episode) {
        res.status(404).json({ error: "Episode not found" });
        return;
      }

      const [animeNumId, epsNum] = episode.ids.split("&eps=");
      const serverResp = await ajaxClient.get(`/ajax/server/list`, {
        params: { servers: animeNumId, eps: epsNum },
        headers: { Referer: `https://anikoto.cz/watch/${animeId}` }
      });
      
      const html = serverResp.data.result || "";
      const $ = cheerio.load(html);
      
      let targetLinkId: string | undefined;
      
      $(".type li[data-link-id]").each((_, el) => {
        const t = $(el).closest(".type").attr("data-type");
        const name = $(el).text().trim();
        const mappedName = mapServerName(name);

        if (t === type && mappedName === serverName) {
          targetLinkId = $(el).attr("data-link-id");
        }
      });
      
      if (!targetLinkId) {
         targetLinkId = $(`.type[data-type='${type}'] li[data-link-id]`).first().attr("data-link-id");
      }
      
      if (!targetLinkId) {
         targetLinkId = $("li[data-link-id]").first().attr("data-link-id");
      }
      
      if (!targetLinkId) {
        res.status(404).json({ error: "No servers found for episode" });
        return;
      }

      const sourceResp = await ajaxClient.get(`/ajax/server`, {
        params: { get: targetLinkId },
        headers: { Referer: `https://anikoto.cz/watch/${animeId}` }
      });
      
      const url = sourceResp.data.result?.url;
      let finalUrl = url;
      let isM3U8 = url?.includes(".m3u8");
      let intro = { start: 0, end: 0 };
      let outro = { start: 0, end: 0 };
      let subtitles: any[] = [];
      
      if (sourceResp.data.result?.intro) intro = sourceResp.data.result.intro;
      if (sourceResp.data.result?.outro) outro = sourceResp.data.result.outro;
      if (sourceResp.data.result?.tracks) subtitles = sourceResp.data.result.tracks;
      
      if (url && (url.includes('megaplay') || url.includes('vidwish') || url.includes('megacloud') || url.includes('rabbitstream') || url.includes('vidstream'))) {
         try {
               const host = new URL(url).origin;
               const r = await axios.get(url, {
                  headers: {
                    "Accept": "*/*",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": "https://anikoto.cz/"
                  },
                  timeout: 10000
               });
               const $r = cheerio.load(r.data);
               const id = $r("#megaplay-player").attr("data-id") || $r("#megacloud-player").attr("data-id") || $r("#rabbitstream-player").attr("data-id") || $r("[data-id]").first().attr("data-id");
               
               if (id) {
                   const sourceUrl = `${host}/stream/getSources?id=${encodeURIComponent(id)}`;
                   const sr = await axios.get(sourceUrl, {
                       headers: {
                           "Accept": "*/*",
                           "X-Requested-With": "XMLHttpRequest",
                           "Referer": `${host}/`
                       },
                       timeout: 10000
                   });
                   if (sr.data && sr.data.sources && sr.data.sources.file) {
                       finalUrl = sr.data.sources.file;
                       isM3U8 = true;
                       if (sr.data.intro) intro = sr.data.intro;
                       if (sr.data.outro) outro = sr.data.outro;
                       if (sr.data.tracks) subtitles = sr.data.tracks;
                   } else {
                       isM3U8 = false;
                   }
               } else {
                   isM3U8 = false;
               }
           } catch(e: any) {
               console.log("MegaPlay extraction failed, falling back to Iframe URL:", e.message);
               isM3U8 = false;
           }
      }

      res.json({
        success: true,
        animeTitle: matchedAnime.title,
        animeId: animeId,
        data: {
               m3u8: isM3U8 ? finalUrl : null,
               referer: url ? new URL(url).origin + "/" : null,
               intro,
               outro,
               subtitles
          }
      });
    } catch (e: any) {
      console.error("Stream error:", e.message);
      res.status(500).json({ success: false, error: "Failed to scrape stream", details: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
