function performSearch() {
  const searchEl = document.getElementById("search");
  if (!searchEl) return;
  const query = searchEl.value.toLowerCase();
  const items = document.querySelectorAll("li");
  items.forEach((item) => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(query) ? "flex" : "none";
  });
}

const searchInput = document.getElementById("search");
if (searchInput) {
  searchInput.addEventListener("input", performSearch);

  const urlParams = new URLSearchParams(window.location.search);
  const searchTerm = urlParams.get("search");

  if (searchTerm) {
    searchInput.value = searchTerm;
    performSearch();
  }
}
