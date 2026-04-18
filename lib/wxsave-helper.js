// wxsave-helper.js - runs via --browser-script BEFORE page load
// Handles WeChat Official Account lazy-loaded images by fetching each
// data-src URL directly and embedding as base64, bypassing SingleFile's
// resource-fetcher entirely (which seems to decide the inline set early).

(() => {
  const TAG = "[wxsave-helper]";
  console.log(TAG, "script injected");

  const blobToDataUri = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });

  const inlineOne = async (img) => {
    const url = img.dataset.src;
    if (!url) return false;
    try {
      const resp = await fetch(url, {
        credentials: "include",
        referrerPolicy: "strict-origin-when-cross-origin",
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const blob = await resp.blob();
      const uri = await blobToDataUri(blob);
      img.setAttribute("src", uri);
      img.removeAttribute("data-src");
      if (img.hasAttribute("width") && img.getAttribute("width") === "1") {
        img.removeAttribute("width");
      }
      return true;
    } catch (e) {
      console.warn(TAG, "inline failed for", url, e.message);
      // fall back: set real url as src so SingleFile can try
      img.setAttribute("src", url);
      return false;
    }
  };

  const inlineSrcset = (img) => {
    const real = img.dataset.srcset;
    if (real) img.setAttribute("srcset", real);
  };

  const scrollThrough = () =>
    new Promise((resolve) => {
      let y = 0;
      const step = 600;
      const t = setInterval(() => {
        window.scrollBy(0, step);
        y += step;
        if (y >= document.body.scrollHeight + 800) {
          clearInterval(t);
          window.scrollTo(0, 0);
          setTimeout(resolve, 400);
        }
      }, 60);
    });

  const run = async () => {
    const m = document.createElement("meta");
    m.name = "wxsave-status";
    m.content = "helper-running";
    (document.head || document.documentElement).appendChild(m);

    await scrollThrough();

    const imgs = [...document.querySelectorAll("img[data-src]")];
    console.log(TAG, "inlining", imgs.length, "lazy images");

    let ok = 0;
    const BATCH = 6;
    for (let i = 0; i < imgs.length; i += BATCH) {
      const chunk = imgs.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map(inlineOne));
      ok += results.filter(Boolean).length;
    }

    document.querySelectorAll("img[data-srcset]").forEach(inlineSrcset);

    console.log(TAG, `inlined ${ok}/${imgs.length}`);
    m.content = `helper-done:${ok}/${imgs.length}`;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
