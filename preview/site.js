// Videos are optional. A future local file can be attached with data-src on a video.
// Media outside the hero is loaded only when it approaches the viewport.
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const videos = [...document.querySelectorAll('video[data-src]')];
  if (!videos.length) return;
  const load = video => {
    if (video.dataset.loaded === 'true') return;
    video.src = video.dataset.src;
    video.dataset.loaded = 'true';
    video.load();
    if (!reduceMotion) video.play().catch(() => {});
  };
  if (!('IntersectionObserver' in window)) {
    videos.forEach(load);
    return;
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      load(entry.target);
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '300px' });
  videos.forEach(video => video.closest('[data-media-slot="hero"]') ? load(video) : observer.observe(video));
})();
