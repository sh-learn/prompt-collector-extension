(async () => {
  const MAX_MEDIA = 12;
  const MIN_IMAGE_SIZE = 160;

  function textOf(node) {
    return (node?.innerText || node?.textContent || "").replace(/\s+\n/g, "\n").trim();
  }

  function uniqBy(items, keyFn) {
    const seen = new Set();
    return items.filter((item) => {
      const key = keyFn(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function selectedText() {
    return String(window.getSelection?.() || "").trim();
  }

  function currentTweetArticle() {
    if (!location.hostname.includes("x.com") && !location.hostname.includes("twitter.com")) {
      return null;
    }
    const articles = [...document.querySelectorAll("article[data-testid='tweet']")];
    const statusPath = location.pathname.match(/^\/[^/]+\/status\/\d+/)?.[0] || "";
    const linkedArticle = statusPath && articles.find((article) => [...article.querySelectorAll("time")]
      .some((time) => {
        try {
          return new URL(time.closest("a[href]")?.href || "", location.href).pathname.startsWith(statusPath);
        } catch {
          return false;
        }
      }));
    if (linkedArticle) return linkedArticle;
    return articles.find((article) => {
      const rect = article.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    }) || articles[0] || null;
  }

  function extractTweet(article) {
    if (!article) return null;
    const tweetText = textOf(article.querySelector("[data-testid='tweetText']")) || textOf(article);
    const author = textOf(article.querySelector("[data-testid='User-Name']"))
      .split("\n")
      .filter(Boolean)
      .slice(0, 2)
      .join(" ");
    const time = article.querySelector("time")?.dateTime || "";
    return { prompt: tweetText, author, time };
  }

  function upgradeImageUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      if (url.hostname.includes("twimg.com") && url.pathname.includes("/media/")) {
        url.searchParams.set("name", "orig");
      }
      return url.href;
    } catch {
      return rawUrl;
    }
  }

  function normalizedText(rawText = "") {
    return String(rawText).replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function promptTypeFromMarker(marker = "") {
    const text = marker.toLowerCase();
    if (/seedance|视频|video/.test(text)) return "video";
    if (/分镜|故事板|storyboard/.test(text)) return "storyboard";
    return "prompt";
  }

  function promptMarkerFromLine(line = "") {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const markerGroups = [
      {
        labels: ["seedance参考提示词", "seedance reference prompt", "视频提示词", "video prompt"],
        type: "video"
      },
      {
        labels: ["分镜故事板提示词", "分镜提示词", "故事板提示词", "storyboard prompt"],
        type: "storyboard"
      },
      {
        labels: ["完整提示词", "prompt", "提示词", "指令"],
        type: "prompt"
      }
    ];
    for (const group of markerGroups) {
      for (const label of group.labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const colon = trimmed.match(new RegExp(`^${escaped}\\s*[:：]\\s*(.*)$`, "i"));
        if (colon) return { label, type: group.type, inlineText: colon[1].trim() };
        if (new RegExp(`^${escaped}\\s*$`, "i").test(trimmed)) {
          return { label, type: group.type, inlineText: "" };
        }
      }
    }
    return null;
  }

  function extractPromptSections(rawText) {
    const text = normalizedText(rawText);
    if (!text) return [];
    const sections = [];
    let active = null;
    const flush = () => {
      if (!active) return;
      const section = active.lines.join("\n").trim();
      if (section) {
        sections.push({
          label: active.label,
          type: active.type || promptTypeFromMarker(active.label),
          text: section.slice(0, 12000)
        });
      }
    };
    for (const line of text.split("\n")) {
      const marker = promptMarkerFromLine(line);
      if (marker) {
        flush();
        active = {
          label: marker.label,
          type: marker.type,
          lines: marker.inlineText ? [marker.inlineText] : []
        };
      } else if (active) {
        active.lines.push(line);
      }
    }
    flush();
    return sections;
  }

  function extractPromptFromText(rawText) {
    return extractPromptSections(rawText)[0]?.text || "";
  }

  function tweetPostUrl(article) {
    const timeLink = article?.querySelector("time")?.closest("a[href]");
    try {
      return timeLink ? new URL(timeLink.href, location.href).href : location.href;
    } catch {
      return location.href;
    }
  }

  function tweetIdFromUrl(url = "") {
    try {
      return new URL(url, location.href).pathname.match(/\/status\/(\d+)/)?.[1] || "";
    } catch {
      return "";
    }
  }

  function promptCandidates(rawText, idPrefix) {
    const sections = extractPromptSections(rawText || "");
    if (sections.length) {
      return sections.map((section, index) => ({
        id: `${idPrefix}-prompt-${index + 1}`,
        text: section.text,
        label: section.label,
        type: section.type,
        reason: "marker"
      }));
    }
    const text = normalizedText(rawText || "");
    return text ? [{ id: `${idPrefix}-prompt-1`, text, type: "prompt", reason: "post_text" }] : [];
  }

  function imageUrl(img) {
    const srcset = img.currentSrc || img.src || "";
    if (!srcset || srcset.startsWith("data:")) return "";
    try {
      const url = new URL(srcset, location.href);
      if (url.hostname.includes("profile_images")) return "";
      return upgradeImageUrl(url.href);
    } catch {
      return "";
    }
  }

  function extractImages(scope = document) {
    const images = [...scope.querySelectorAll("img")]
      .filter((img) => {
        const rect = img.getBoundingClientRect();
        const width = img.naturalWidth || rect.width;
        const height = img.naturalHeight || rect.height;
        return width >= MIN_IMAGE_SIZE && height >= MIN_IMAGE_SIZE;
      })
      .map((img) => ({
        url: imageUrl(img),
        alt: img.alt || "",
        width: img.naturalWidth || Math.round(img.getBoundingClientRect().width),
        height: img.naturalHeight || Math.round(img.getBoundingClientRect().height)
      }));

    return uniqBy(images, (image) => image.url).slice(0, MAX_MEDIA);
  }

  function mediaUrl(rawUrl) {
    if (!rawUrl || rawUrl.startsWith("data:") || rawUrl.startsWith("blob:")) return "";
    try {
      return new URL(rawUrl, location.href).href;
    } catch {
      return "";
    }
  }

  function extractVideos(scope = document) {
    const videos = [...scope.querySelectorAll("video")]
      .map((video) => {
        const source = video.currentSrc || video.src || video.querySelector("source[src]")?.src || "";
        const rect = video.getBoundingClientRect();
        return {
          url: mediaUrl(source),
          poster: mediaUrl(video.poster || ""),
          width: video.videoWidth || Math.round(rect.width),
          height: video.videoHeight || Math.round(rect.height)
        };
      })
      .filter((video) => video.url);

    return uniqBy(videos, (video) => video.url).slice(0, MAX_MEDIA);
  }

  async function cachedXData() {
    const localVideos = Array.isArray(globalThis.__PROMPT_COLLECTOR_X_VIDEOS)
      ? globalThis.__PROMPT_COLLECTOR_X_VIDEOS
      : [];
    const localTweets = Array.isArray(globalThis.__PROMPT_COLLECTOR_X_TWEETS)
      ? globalThis.__PROMPT_COLLECTOR_X_TWEETS
      : [];
    if (!globalThis.chrome?.runtime?.sendMessage) return { videos: localVideos, tweets: localTweets };
    try {
      const response = await chrome.runtime.sendMessage({ type: "x:videos:get", href: location.href });
      return {
        videos: uniqBy([...(response?.videos || []), ...localVideos], (video) => video.url).slice(0, MAX_MEDIA),
        tweets: uniqBy([...(response?.tweets || []), ...localTweets], (tweet) => tweet.tweetId).slice(-160)
      };
    } catch {
      return { videos: localVideos, tweets: localTweets };
    }
  }

  function extractLinks(scope = document) {
    return uniqBy(
      [...scope.querySelectorAll("a[href]")]
        .map((link) => {
          try {
            return new URL(link.href, location.href).href;
          } catch {
            return "";
          }
        })
        .filter(Boolean),
      (href) => href
    ).slice(0, 24);
  }

  function xArticleImages(article, idPrefix) {
    const imageCandidates = extractImages(article)
      .filter((image) => image.url.includes("pbs.twimg.com/media/"))
      .map((image) => ({ ...image, source: "tweet_image" }));
    const videoPosterCandidates = [...article.querySelectorAll("video")]
      .map((video) => {
        const rect = video.getBoundingClientRect();
        const poster = mediaUrl(video.poster || "");
        return poster && poster.includes("pbs.twimg.com/")
          ? {
              url: upgradeImageUrl(poster),
              alt: "X video cover",
              width: video.videoWidth || Math.round(rect.width),
              height: video.videoHeight || Math.round(rect.height),
              source: "video_poster"
            }
          : null;
      })
      .filter(Boolean);
    return uniqBy([...imageCandidates, ...videoPosterCandidates], (image) => image.url)
      .slice(0, MAX_MEDIA)
      .map((image, index) => ({ ...image, id: `${idPrefix}-image-${index + 1}` }));
  }

  function xArticleVideos(article, idPrefix, cachedVideos) {
    const tweetId = tweetIdFromUrl(tweetPostUrl(article));
    if (!tweetId) return [];
    return uniqBy(
      (cachedVideos || [])
        .filter((video) => video.tweetId === tweetId && video.url)
        .map((video, index) => ({
          url: video.url,
          poster: video.poster || "",
          width: video.width || 0,
          height: video.height || 0,
          id: `${idPrefix}-video-${index + 1}`
        })),
      (video) => video.url
    ).slice(0, MAX_MEDIA);
  }

  function cachedTweetText(cachedTweets, tweetId, fallbackText) {
    const cached = (cachedTweets || []).find((tweet) => tweet.tweetId === tweetId && tweet.text);
    return cached && cached.text.length > String(fallbackText || "").length ? cached.text : fallbackText;
  }

  function xCandidates(mainArticle, cachedVideos, cachedTweets) {
    if (!mainArticle) return [];
    const articles = [...document.querySelectorAll("article[data-testid='tweet']")];
    return uniqBy([mainArticle, ...articles].filter(Boolean), (article) => article)
      .map((article, index) => {
        const id = `x-post-${index + 1}`;
        const extracted = extractTweet(article);
        const postUrl = tweetPostUrl(article);
        const tweetId = tweetIdFromUrl(postUrl);
        const rawText = cachedTweetText(cachedTweets, tweetId, extracted?.prompt || textOf(article));
        return {
          id,
          kind: index === 0 ? "main" : "reply",
          author: extracted?.author || "",
          postUrl,
          rawText,
          promptCandidates: promptCandidates(rawText, id),
          images: xArticleImages(article, id),
          videos: xArticleVideos(article, id, cachedVideos)
        };
      })
      .filter((candidate) => candidate.rawText || candidate.images.length || candidate.videos.length);
  }

  const article = currentTweetArticle();
  const xData = await cachedXData();
  const xVideos = xData.videos;
  const tweet = extractTweet(article);
  const main = article || document.querySelector("main") || document.body;
  const selection = selectedText();
  const rawText = textOf(main).slice(0, 12000);
  const prompt = selection || extractPromptFromText(tweet?.prompt || rawText);
  const firstLine = (prompt || tweet?.prompt || rawText).split("\n").find(Boolean) || "";
  const title = (firstLine || document.title).replace(/\s+[-|]\s+X$/, "").trim().slice(0, 120);
  const isX = Boolean(article);
  const candidates = isX ? xCandidates(article, xVideos, xData.tweets) : [];
  const videos = isX ? xArticleVideos(article, "x-main", xVideos) : extractVideos(main);

  return {
    title: title || "未命名提示词",
    prompt,
    sourceUrl: location.href,
    pageTitle: document.title,
    author: tweet?.author || "",
    site: isX ? "x" : "generic",
    images: extractImages(main),
    videos,
    links: extractLinks(main),
    capturedAt: tweet?.time || new Date().toISOString(),
    rawText,
    candidates
  };
})();
