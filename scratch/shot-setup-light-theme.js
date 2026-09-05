(() => {
  const html = document.documentElement;
  html.classList.remove("light", "grey", "dark");
  html.classList.add("light");
  try {
    window.localStorage.setItem("starry-night.theme", "light");
  } catch {
    // ignore
  }
  return "light-theme-set";
})();
