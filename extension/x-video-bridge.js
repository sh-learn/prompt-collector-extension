(() => {
  if (globalThis.__PROMPT_COLLECTOR_X_VIDEO_BRIDGE__) return;
  globalThis.__PROMPT_COLLECTOR_X_VIDEO_BRIDGE__ = true;
  globalThis.__PROMPT_COLLECTOR_X_VIDEOS = globalThis.__PROMPT_COLLECTOR_X_VIDEOS || [];
  globalThis.__PROMPT_COLLECTOR_X_TWEETS = globalThis.__PROMPT_COLLECTOR_X_TWEETS || [];

  function mergeVideos(videos = []) {
    const byUrl = new Map(globalThis.__PROMPT_COLLECTOR_X_VIDEOS.map((video) => [video.url, video]));
    for (const video of videos) {
      if (video?.url) byUrl.set(video.url, { ...byUrl.get(video.url), ...video });
    }
    globalThis.__PROMPT_COLLECTOR_X_VIDEOS = [...byUrl.values()].slice(-80);
  }

  function mergeTweets(tweets = []) {
    const byId = new Map(globalThis.__PROMPT_COLLECTOR_X_TWEETS.map((tweet) => [tweet.tweetId, tweet]));
    for (const tweet of tweets) {
      if (!tweet?.tweetId || !tweet.text) continue;
      const previous = byId.get(tweet.tweetId);
      if (!previous || String(tweet.text).length >= String(previous.text || "").length) {
        byId.set(tweet.tweetId, { ...previous, ...tweet });
      }
    }
    globalThis.__PROMPT_COLLECTOR_X_TWEETS = [...byId.values()].slice(-160);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.source !== "prompt-collector" || data.type !== "prompt-collector:x-videos") return;
    const videos = Array.isArray(data.videos) ? data.videos : [];
    const tweets = Array.isArray(data.tweets) ? data.tweets : [];
    mergeVideos(videos);
    mergeTweets(tweets);
    chrome.runtime.sendMessage({
      type: "x:videos:found",
      href: location.href,
      sourceUrl: data.sourceUrl || "",
      videos,
      tweets
    }).catch(() => {});
  });
})();
