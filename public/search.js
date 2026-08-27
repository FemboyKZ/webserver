(function () {
  const searchInput = document.getElementById("search");
  if (!searchInput) return;

  const rows = Array.from(document.querySelectorAll("li")).map((el) => ({
    el,
    text: el.textContent.toLowerCase(),
    hidden: false,
  }));

  let lastQuery = null;

  function performSearch() {
    const query = searchInput.value.toLowerCase();
    if (query === lastQuery) return;
    lastQuery = query;

    for (const row of rows) {
      const hide = query !== "" && !row.text.includes(query);
      if (row.hidden === hide) continue;
      row.hidden = hide;
      row.el.classList.toggle("is-hidden", hide);
    }
  }

  let debounce = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(performSearch, 120);
  });

  const searchTerm = new URLSearchParams(window.location.search).get("search");
  if (searchTerm) {
    searchInput.value = searchTerm;
    performSearch();
  }
})();
