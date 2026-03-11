function performSearch() {
  const query = document.getElementById("search").value.toLowerCase();
  const items = document.querySelectorAll("li");
  items.forEach((item) => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(query) ? "flex" : "none";
  });
}

document.getElementById("search").addEventListener("input", performSearch);

const urlParams = new URLSearchParams(window.location.search);
const searchTerm = urlParams.get("search");

if (searchTerm) {
  const search = document.getElementById("search");
  search.value = searchTerm;
  performSearch();
}
