(() => {
  if (window.__PROMPT_COLLECTOR_X_VIDEO_OBSERVER__) return;
  window.__PROMPT_COLLECTOR_X_VIDEO_OBSERVER__ = true;

  const MESSAGE_SOURCE = "prompt-collector";
  const MESSAGE_TYPE = "prompt-collector:x-videos";
  const GRAPHQL_PATTERN = /\/graphql\/.*(?:TweetDetail|TweetResultByRestId|UserTweets|HomeTimeline|SearchTimeline|UserMedia)/;

  function endpointName(url = "") {
    try {
      return new URL(url, location.href).pathname.split("/").filter(Boolean).pop() || "";
    } catch {
      return "";
    }
  }

  function shouldInspect(url = "") {
    return GRAPHQL_PATTERN.test(url);
  }

  function tweetIdFromUrl(value = "") {
    try {
      return new URL(value, location.href).pathname.match(/\/status\/(\d+)/)?.[1] || "";
    } catch {
      return "";
    }
  }

  function bestMp4(variants = []) {
    return variants
      .filter((variant) => variant?.url && variant.content_type === "video/mp4")
      .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0))[0] || null;
  }

  function textFromTweetNode(node = {}) {
    return (
      node.note_tweet?.note_tweet_results?.result?.text ||
      node.note_tweet_results?.result?.text ||
      node.legacy?.full_text ||
      node.full_text ||
      node.text ||
      ""
    );
  }

  function scanForTweetsAndVideos(node, context = {}, out = { tweets: [], videos: [] }) {
    if (!node || typeof node !== "object") return out;

    const next = { ...context };
    if (node.rest_id) next.tweetId = String(node.rest_id);
    if (node.id_str) next.tweetId = String(node.id_str);
    if (node.legacy?.id_str) next.tweetId = String(node.legacy.id_str);
    if (node.legacy?.screen_name) next.author = `@${node.legacy.screen_name}`;
    if (node.core?.user_results?.result?.legacy?.screen_name) {
      next.author = `@${node.core.user_results.result.legacy.screen_name}`;
    }
    if (node.expanded_url) {
      const tweetId = tweetIdFromUrl(node.expanded_url);
      if (tweetId) next.tweetId = tweetId;
    }
    if (node.media_url_https || node.media_url) {
      next.poster = node.media_url_https || node.media_url;
    }

    const text = textFromTweetNode(node);
    if (next.tweetId && text) {
      out.tweets.push({
        tweetId: next.tweetId,
        author: next.author || "",
        text: String(text)
      });
    }

    if (node.video_info && Array.isArray(node.video_info.variants)) {
      const best = bestMp4(node.video_info.variants);
      if (best) {
        out.videos.push({
          url: best.url,
          tweetId: next.tweetId || "",
          author: next.author || "",
          poster: next.poster || "",
          bitrate: Number(best.bitrate || 0),
          contentType: best.content_type || "video/mp4"
        });
      }
    }

    for (const value of Object.values(node)) {
      scanForTweetsAndVideos(value, next, out);
    }
    return out;
  }

  function uniqueVideos(videos = []) {
    const seen = new Set();
    return videos.filter((video) => {
      if (!video.url || seen.has(video.url)) return false;
      seen.add(video.url);
      return true;
    });
  }

  function uniqueTweets(tweets = []) {
    const byId = new Map();
    for (const tweet of tweets) {
      if (!tweet.tweetId || !tweet.text) continue;
      const previous = byId.get(tweet.tweetId);
      if (!previous || tweet.text.length > previous.text.length) {
        byId.set(tweet.tweetId, tweet);
      }
    }
    return [...byId.values()];
  }

  function emitVideos(data, sourceUrl) {
    const scanned = scanForTweetsAndVideos(data);
    const videos = uniqueVideos(scanned.videos).map((video) => ({
      ...video,
      endpoint: endpointName(sourceUrl)
    }));
    const tweets = uniqueTweets(scanned.tweets);
    if (!videos.length && !tweets.length) return;
    window.postMessage({
      source: MESSAGE_SOURCE,
      type: MESSAGE_TYPE,
      href: location.href,
      sourceUrl,
      videos,
      tweets,
      at: Date.now()
    }, "*");
  }

  const originalFetch = window.fetch;
  window.fetch = async function promptCollectorFetch(...args) {
    const response = await originalFetch.apply(this, args);
    const request = args[0];
    const url = typeof request === "string" ? request : request?.url || "";
    if (shouldInspect(url)) {
      response.clone().json().then((data) => emitVideos(data, url)).catch(() => {});
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function promptCollectorOpen(method, url, ...rest) {
    this.__promptCollectorUrl = String(url || "");
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function promptCollectorSend(...args) {
    if (shouldInspect(this.__promptCollectorUrl || "")) {
      this.addEventListener("loadend", () => {
        try {
          emitVideos(JSON.parse(this.responseText || "{}"), this.__promptCollectorUrl);
        } catch {
          // Ignore non-JSON and opaque responses.
        }
      });
    }
    return originalSend.apply(this, args);
  };
})();
