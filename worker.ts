import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as cheerio from 'cheerio'

// Clean, verified Hono worker application for Cloudflare
const app = new Hono()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['*'],
  exposeHeaders: ['*'],
}))

// Welcome and API usage documentation route
app.get("/", (c) => {
  return c.json({
    success: true,
    message: "Welcome to the Anikoto x Anilist Scraper API!",
    endpoints: {
      search: "/api/search?keyword=One Piece",
      episodes: "/api/episodes?id=one-piece-odmau (or AniList ID)",
      servers: "/api/servers?id=one-piece-odmau&ep=ep-1",
      stream: "/api/stream?id=one-piece-odmau&ep=ep-1&server=hd-1"
    }
  });
});

// Custom 404 Not Found Handler with route guidance
app.notFound((c) => {
  return c.json({
    success: false,
    error: "Route Not Found",
    message: `The requested path '${c.req.path}' does not exist on this API.`,
    endpoints: {
      search: "/api/search?keyword=One Piece",
      episodes: "/api/episodes?id=one-piece-odmau (or AniList ID)",
      servers: "/api/servers?id=one-piece-odmau&ep=ep-1",
      stream: "/api/stream?id=one-piece-odmau&ep=ep-1&server=hd-1"
    }
  }, 404);
});

// Global Error Handler to expose details for quick debugging
app.onError((err, c) => {
  console.error("Global Worker Error:", err);
  return c.json({
    success: false,
    error: "Internal Server Error",
    message: err.message || String(err),
    stack: err.stack || null
  }, 500);
});

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const AJAX_HEADERS = {
  ...HEADERS,
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
  "Referer": "https://anikoto.cz",
};

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
      
      if(sub) sub = sub.replace(/\D+/g, '');
      if(dub) dub = dub.replace(/\D+/g, '');
      if(episodes) episodes = episodes.replace(/\D+/g, '');
      
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
  const watchDataResp = await fetch(`https://anikoto.cz/watch/${animeId}`, { headers: HEADERS });
  const watchData = await watchDataResp.text();
  const $ = cheerio.load(watchData);
  const numericId = $("[data-id]").first().attr("data-id");
  
  if (!numericId) throw new Error("Could not find numeric ID");

  const resp = await fetch(`https://anikoto.cz/ajax/episode/list/${numericId}`, {
    headers: { ...AJAX_HEADERS, Referer: `https://anikoto.cz/watch/${animeId}` }
  });
  const data = await resp.json();
  const html = data.result;
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
    searchQueries = [];
    try {
      // Primary fallback: Kitsu mapping API (which has explicit anilist -> anime mapping)
      const kitsuResp = await fetch(`https://kitsu.io/api/edge/mappings?filter[externalSite]=anilist/anime&filter[externalId]=${queryId}&include=item`);
      if (kitsuResp.ok) {
        const kitsuData = await kitsuResp.json() as any;
        if (kitsuData.included && kitsuData.included.length > 0) {
          const attributes = kitsuData.included[0].attributes;
          const titles = attributes.titles;
          if (titles?.en) searchQueries.push(titles.en);
          if (titles?.en_jp) searchQueries.push(titles.en_jp);
          if (attributes?.canonicalTitle && !searchQueries.includes(attributes.canonicalTitle)) {
            searchQueries.push(attributes.canonicalTitle);
          }
        }
      }

      // Secondary fallback: Jikan API (MAL IDs and AniList IDs often match for popular/older shows)
      if (searchQueries.length === 0) {
        const jikanResp = await fetch(`https://api.jikan.moe/v4/anime/${queryId}`);
        if (jikanResp.ok) {
          const jikanData = await jikanResp.json() as any;
          if (jikanData.data) {
             if (jikanData.data.title_english) searchQueries.push(jikanData.data.title_english);
             if (jikanData.data.title) searchQueries.push(jikanData.data.title);
          }
        }
      }
      
    } catch(e: any) {
      console.error("Anime ID lookup failed:", e.message || e);
    }
    if (searchQueries.length === 0) searchQueries.push(queryId);
  }

  let matchedAnime: any = null;

  for (const sq of searchQueries) {
    const url = new URL("https://anikoto.cz/filter");
    url.searchParams.append("keyword", sq);
    try {
      const resp = await fetch(url.toString(), { headers: HEADERS });
      const text = await resp.text();
      const results = extractAnimeList(text);
      if (results.length > 0) {
        const lowerSq = sq.toLowerCase();
        matchedAnime = results.find(r => r.title.toLowerCase() === lowerSq);
        if (matchedAnime) {
          break;
        }
      }
    } catch (e: any) {
      console.error("Search error:", e.message);
    }
  }

  if (!matchedAnime) {
    const url = new URL("https://anikoto.cz/filter");
    url.searchParams.append("keyword", searchQueries[0]);
    try {
      const resp = await fetch(url.toString(), { headers: HEADERS });
      const text = await resp.text();
      const results = extractAnimeList(text);
      if (results.length > 0) {
        matchedAnime = results[0];
      }
    } catch (e: any) {
      console.error("Fallback search error:", e.message);
    }
  }

  // Fallback: If not found in search results and doesn't look like a plain numeric ID (not AniList),
  // treat the queryId directly as the anime ID (slug).
  if (!matchedAnime && queryId && !isAnilistId) {
    matchedAnime = {
      id: queryId,
      title: queryId.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    };
  }

  return { matchedAnime };
}

app.get("/api/search", async (c) => {
  const keyword = c.req.query("keyword");
  if (!keyword) {
    return c.json({ error: "Keyword required" }, 400);
  }
  try {
    const url = new URL("https://anikoto.cz/filter");
    url.searchParams.append("keyword", keyword);
    const resp = await fetch(url.toString(), { headers: HEADERS });
    const text = await resp.text();
    const results = extractAnimeList(text);
    return c.json({ success: true, data: results });
  } catch (e: any) {
    return c.json({ success: false, error: "Failed to scrape search results", details: e.message }, 500);
  }
});

app.get("/api/episodes", async (c) => {
  const queryId = c.req.query("id");
  if (!queryId) {
    return c.json({ success: false, error: "Anime ID or Title is required in 'id' query parameter" }, 400);
  }

  try {
    const { matchedAnime } = await resolveAnime(queryId);

    if (!matchedAnime) {
      return c.json({ success: false, error: "Anime not found on anikoto.cz" }, 404);
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
    return c.json({ success: true, animeTitle: matchedAnime.title, animeId: animeId, data: formattedEpisodes });
  } catch (e: any) {
    return c.json({ success: false, error: "Failed to scrape episodes", details: e.message }, 500);
  }
});

app.get("/api/servers", async (c) => {
  const queryId = c.req.query("id");
  const epSlug = c.req.query("ep");
  if (!queryId || !epSlug) {
    return c.json({ error: "Missing id or ep parameter" }, 400);
  }
  try {
    const { matchedAnime } = await resolveAnime(queryId);
    if (!matchedAnime) {
      return c.json({ success: false, error: "Anime not found on anikoto.cz" }, 404);
    }

    const animeId = matchedAnime.id;
    const { episodes } = await getEpisodesData(animeId);
    const episode = episodes.find(e => e.slug === epSlug);
    
    if (!episode) {
      return c.json({ error: "Episode not found" }, 404);
    }

    const [animeNumId, epsNum] = episode.ids.split("&eps=");
    const url = new URL("https://anikoto.cz/ajax/server/list");
    url.searchParams.append("servers", animeNumId);
    url.searchParams.append("eps", epsNum);
    const resp = await fetch(url.toString(), {
      headers: { ...AJAX_HEADERS, Referer: `https://anikoto.cz/watch/${animeId}` }
    });
    const data = await resp.json() as { result?: string };
    
    const html = data.result || "";
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
    
    return c.json({ success: true, animeTitle: matchedAnime.title, animeId: animeId, data: servers });
  } catch (e: any) {
    return c.json({ success: false, error: "Failed to scrape servers", details: e.message }, 500);
  }
});

app.get("/api/stream", async (c) => {
  const queryId = c.req.query("id");
  const epSlug = c.req.query("ep");
  const serverName = c.req.query("server");
  const type = c.req.query("type") || "sub";
  if (!queryId || !epSlug || !serverName) {
    return c.json({ error: "Missing required query parameters" }, 400);
  }
  try {
    const { matchedAnime } = await resolveAnime(queryId);
    if (!matchedAnime) {
      return c.json({ success: false, error: "Anime not found on anikoto.cz" }, 404);
    }

    const animeId = matchedAnime.id;
    const { episodes } = await getEpisodesData(animeId);
    const episode = episodes.find(e => e.slug === epSlug);
    if (!episode) {
      return c.json({ error: "Episode not found" }, 404);
    }

    const [animeNumId, epsNum] = episode.ids.split("&eps=");
    const serverUrl = new URL("https://anikoto.cz/ajax/server/list");
    serverUrl.searchParams.append("servers", animeNumId);
    serverUrl.searchParams.append("eps", epsNum);
    const serverResp = await fetch(serverUrl.toString(), {
      headers: { ...AJAX_HEADERS, Referer: `https://anikoto.cz/watch/${animeId}` }
    });
    const serverData = await serverResp.json() as { result?: string };
    
    const html = serverData.result || "";
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
      return c.json({ error: "No servers found for episode" }, 404);
    }

    const sourceUrl = new URL("https://anikoto.cz/ajax/server");
    sourceUrl.searchParams.append("get", targetLinkId);
    const sourceResp = await fetch(sourceUrl.toString(), {
      headers: { ...AJAX_HEADERS, Referer: `https://anikoto.cz/watch/${animeId}` }
    });
    const sourceData = await sourceResp.json() as any;
    
    const url = sourceData.result?.url;
    let finalUrl = url;
    let isM3U8 = url?.includes(".m3u8");
    let intro = { start: 0, end: 0 };
    let outro = { start: 0, end: 0 };
    let subtitles: any[] = [];
    
    if (sourceData.result?.intro) intro = sourceData.result.intro;
    if (sourceData.result?.outro) outro = sourceData.result.outro;
    if (sourceData.result?.tracks) subtitles = sourceData.result.tracks;
    
    if (url && (url.includes('megaplay') || url.includes('vidwish') || url.includes('megacloud') || url.includes('rabbitstream') || url.includes('vidstream'))) {
       try {
             const host = new URL(url).origin;
             const r = await fetch(url, {
                headers: {
                  "Accept": "*/*",
                  "X-Requested-With": "XMLHttpRequest",
                  "Referer": "https://anikoto.cz/"
                }
             });
             const rText = await r.text();
             const $r = cheerio.load(rText);
             const id = $r("#megaplay-player").attr("data-id") || $r("#megacloud-player").attr("data-id") || $r("#rabbitstream-player").attr("data-id") || $r("[data-id]").first().attr("data-id");
             
             if (id) {
                 const extractUrl = `${host}/stream/getSources?id=${encodeURIComponent(id)}`;
                 const sr = await fetch(extractUrl, {
                     headers: {
                         "Accept": "*/*",
                         "X-Requested-With": "XMLHttpRequest",
                         "Referer": `${host}/`
                     }
                 });
                 const srData = await sr.json() as any;
                 if (srData && srData.sources && srData.sources.file) {
                     finalUrl = srData.sources.file;
                     isM3U8 = true;
                     if (srData.intro) intro = srData.intro;
                     if (srData.outro) outro = srData.outro;
                     if (srData.tracks) subtitles = srData.tracks;
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

    return c.json({
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
    return c.json({ success: false, error: "Failed to scrape stream", details: e.message }, 500);
  }
});

export default app;
