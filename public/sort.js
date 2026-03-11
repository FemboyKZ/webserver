let currentSort = "name";
let sortAsc = true;

function sortFiles(key) {
  const list = document.getElementById("file-list");
  if (!list) return;
  if (currentSort === key) {
    sortAsc = !sortAsc;
  } else {
    currentSort = key;
    sortAsc = true;
  }
  const items = Array.from(list.querySelectorAll("li[data-name]"));
  items.sort((a, b) => {
    let va, vb;
    if (key === "size") {
      va = parseInt(a.dataset.size, 10) || 0;
      vb = parseInt(b.dataset.size, 10) || 0;
    } else if (key === "date") {
      va = a.dataset.date || "";
      vb = b.dataset.date || "";
    } else {
      va = a.dataset.name || "";
      vb = b.dataset.name || "";
    }
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sortAsc ? cmp : -cmp;
  });
  const frag = document.createDocumentFragment();
  items.forEach((item) => frag.appendChild(item));
  list.appendChild(frag);
  document.querySelectorAll(".sort-controls a").forEach((a) => {
    a.classList.toggle("sort-active", a.dataset.sortkey === key);
    if (a.dataset.sortkey === key) {
      a.textContent =
        "[" +
        key.charAt(0).toUpperCase() +
        key.slice(1) +
        (sortAsc ? " \u25B2" : " \u25BC") +
        "]";
    } else {
      a.textContent =
        "[" +
        a.dataset.sortkey.charAt(0).toUpperCase() +
        a.dataset.sortkey.slice(1) +
        "]";
    }
  });
}

document.addEventListener("DOMContentLoaded", function () {
  const ctrl = document.querySelector(".sort-controls");
  if (ctrl) {
    const nameBtn = ctrl.querySelector('a[data-sortkey="name"]');
    if (nameBtn) nameBtn.classList.add("sort-active");
    ctrl.querySelectorAll("a[data-sortkey]").forEach((a) => {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        sortFiles(this.dataset.sortkey);
      });
    });
  }
});
