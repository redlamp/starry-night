(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clickByLabel = (label) => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === label || b.textContent.trim() === label,
    );
    if (btn) btn.click();
    return !!btn;
  };
  // Open the City Directory (persona directory cold build is ~2.2s).
  clickByLabel("City Directory");
  await wait(3200);
  // Click a resident name from the marquee to push a persona card.
  const nameBtn = [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === "James Rogers",
  );
  if (nameBtn) nameBtn.click();
  await wait(1200);
  return "setup-done";
})();
