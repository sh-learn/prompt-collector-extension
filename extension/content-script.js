(() => {
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
    return articles.find((article) => article.getBoundingClientRect().top >= 0) || articles[0] || null;
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

  function extractPromptFromText(rawText) {
    const text = rawText.replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const marker = text.match(/(?:^|\n)\s*(prompt|提示词|指令|完整提示词)\s*[:：]\s*/i);
    if (!marker) return "";

    const start = marker.index + marker[0].length;
    const tail = text.slice(start);
    const stop = tail.search(/\n\s*(?:negative prompt|参数|model|source|comments?|回复|转发)\s*[:：]/i);
    return (stop >= 0 ? tail.slice(0, stop) : tail).trim().slice(0, 8000);
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

  const article = currentTweetArticle();
  const tweet = extractTweet(article);
  const main = article || document.querySelector("main") || document.body;
  const selection = selectedText();
  const rawText = textOf(main).slice(0, 12000);
  const prompt = selection || extractPromptFromText(tweet?.prompt || rawText);
  const firstLine = (prompt || tweet?.prompt || rawText).split("\n").find(Boolean) || "";
  const title = (firstLine || document.title).replace(/\s+[-|]\s+X$/, "").trim().slice(0, 120);
  const isX = Boolean(article);

  return {
    title: title || "未命名提示词",
    prompt,
    sourceUrl: location.href,
    pageTitle: document.title,
    author: tweet?.author || "",
    site: isX ? "x" : "generic",
    images: extractImages(main),
    videos: extractVideos(main),
    links: extractLinks(main),
    capturedAt: tweet?.time || new Date().toISOString(),
    rawText
  };
})();
