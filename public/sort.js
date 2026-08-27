(function () {
  const list = document.getElementById("file-list");
  const ctrl = document.querySelector(".sort-controls");
  if (!list || !ctrl) return;

  const rows = Array.from(list.children).map((el) => {
    const link = el.querySelector("a");
    return {
      el,
      name: (link ? link.textContent : el.textContent).toLowerCase(),
      size: parseInt(el.dataset.size, 10) || 0,
      date: el.dataset.date || "",
    };
  });

  const buttons = Array.from(ctrl.querySelectorAll("a[data-sortkey]"));
  let currentSort = "name";
  let sortAsc = true;

  function updateButtons() {
    for (const button of buttons) {
      const key = button.dataset.sortkey;
      const active = key === currentSort;
      const arrow = sortAsc ? " ▲" : " ▼";
      button.classList.toggle("sort-active", active);
      button.textContent =
        "[" +
        key.charAt(0).toUpperCase() +
        key.slice(1) +
        (active ? arrow : "") +
        "]";
    }
  }

  function sortFiles(key) {
    if (currentSort === key) {
      sortAsc = !sortAsc;
    } else {
      currentSort = key;
      sortAsc = true;
    }

    rows.sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });

    const frag = document.createDocumentFragment();
    for (const row of rows) frag.appendChild(row.el);
    list.appendChild(frag);

    updateButtons();
  }

  for (const button of buttons) {
    button.addEventListener("click", (e) => {
      e.preventDefault();
      sortFiles(button.dataset.sortkey);
    });
  }

  updateButtons();
})();
