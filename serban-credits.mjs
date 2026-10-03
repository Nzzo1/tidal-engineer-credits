const ROOT_ID = "enzo-engineer-credits";

export const unloads = new Set();

const groups = [
  {
    key: "mix",
    title: "Mix Engineers",
    role: "mix",
    engineers: [
      { name: "Serban Ghenea", id: 10470066 },
      { name: "Manny Marroquin", id: 13393074 },
      { name: "Mark “Spike” Stent", id: 13459443 },
      { name: "Andrew Scheps" },
      { name: "Tom Elmhirst" },
      { name: "Tchad Blake" },
      { name: "Jaycen Joshua" },
      { name: "Alan Moulder" },
      { name: "Michael Brauer" },
      { name: "Tony Maserati" }
    ]
  },
  {
    key: "mastering",
    title: "Mastering Engineers",
    role: "master",
    engineers: [
      { name: "Randy Merrill" },
      { name: "Chris Gehringer" },
      { name: "Emily Lazar" },
      { name: "Bob Ludwig" },
      { name: "Bernie Grundman" },
      { name: "Mike Bozzi" },
      { name: "Joe LaPorta" },
      { name: "Heba Kadry" },
      { name: "Greg Calbi" },
      { name: "Dale Becker" },
      { name: "Mike Marsh", id: 8940411 },
      { name: "Matt Colton", id: 13502114 }
    ]
  }
];

const openState = {
  mix: false,
  mastering: false
};

const idCache = new Map();

let sortClickPending = false;
let autoSortTargetPath = null;
let updateScheduled = false;

/* --------------------------------------------------
   TIDAL internals
-------------------------------------------------- */

function getLib() {
  return globalThis.luna?.core?.modules?.["@luna/lib"];
}

function normalise(text = "") {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function contributorRoles(item) {
  return (item?.artistRoles ?? [])
    .map(role => role?.category ?? "")
    .join(" ")
    .toLowerCase();
}

function candidateScore(item, entry, wantedRole) {
  const actual = normalise(item?.name);
  const display = normalise(entry.name);
  const query = normalise(entry.query ?? entry.name);

  let score = 0;

  if (actual === display) score += 100;
  if (actual === query) score += 90;

  if (actual.includes(query)) score += 60;

  const words = query.split(" ").filter(Boolean);

  if (
    words.length &&
    words.every(word => actual.includes(word))
  ) {
    score += 40;
  }

  if (item?.artistTypes?.includes("CONTRIBUTOR")) {
    score += 30;
  }

  const roles = contributorRoles(item);

  if (wantedRole === "mix" && roles.includes("mix")) {
    score += 40;
  }

  if (
    wantedRole === "master" &&
    roles.includes("master")
  ) {
    score += 40;
  }

  return score;
}

async function resolveContributor(entry, wantedRole) {
  const key = `${wantedRole}:${entry.name}`;

  // Manually verified TIDAL Credits page
  if (entry.id) {
    idCache.set(key, entry.id);
    return entry.id;
  }

  if (idCache.has(key)) {
    return idCache.get(key);
  }

  const lib = getLib();
  const TidalApi = lib?.TidalApi;

  if (!TidalApi) {
    console.error(
      "[Engineer Credits] TidalApi unavailable"
    );

    return undefined;
  }

  const query = entry.query ?? entry.name;

  try {
    const url =
      "https://desktop.tidal.com/v1/search?" +
      `query=${encodeURIComponent(query)}` +
      "&limit=50&offset=0&" +
      TidalApi.queryArgs();

    const response = await TidalApi.fetch(url);

    const candidates =
      response?.artists?.items ?? [];

    const ranked = [...candidates]
      .map(item => ({
        item,
        score: candidateScore(
          item,
          entry,
          wantedRole
        )
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];

    if (!best || best.score < 30) {
      console.warn(
        "[Engineer Credits] No contributor found:",
        entry.name,
        candidates
      );

      return undefined;
    }

    idCache.set(key, best.item.id);

    console.log(
      "[Engineer Credits]",
      entry.name,
      "→",
      best.item.name,
      best.item.id
    );

    return best.item.id;
  } catch (error) {
    console.error(
      "[Engineer Credits] Search failed:",
      entry.name,
      error
    );

    return undefined;
  }
}

/* --------------------------------------------------
   Navigation
-------------------------------------------------- */

function openCredits(id) {
  const lib = getLib();

  const push =
    lib?.redux?.actions?.["router/PUSH"];

  const path = `/credits/${id}`;

  // Auto-sort only the Credits page opened from our sidebar.
  // Once it reaches newest-first, stop controlling its sorting.
  autoSortTargetPath = path;

  if (push) {
    push({
      pathname: path,
      search: "",
      replace: false
    });
  } else {
    history.pushState({}, "", path);

    window.dispatchEvent(
      new PopStateEvent(
        "popstate",
        { state: {} }
      )
    );
  }

  setTimeout(ensureNewestFirst, 200);
  setTimeout(ensureNewestFirst, 700);
  setTimeout(ensureNewestFirst, 1500);
}

/* --------------------------------------------------
   Always YEAR newest → oldest
-------------------------------------------------- */

function getYearHeader() {
  return [
    ...document.querySelectorAll(
      '[role="columnheader"]'
    )
  ].find(
    element =>
      element.textContent
        ?.trim()
        .toUpperCase() === "YEAR"
  );
}

function ensureNewestFirst() {
  // Do nothing on Credits pages that were not opened by our plugin.
  if (!autoSortTargetPath) return;

  // Only control the exact engineer page we just opened.
  if (location.pathname !== autoSortTargetPath) return;

  const year = getYearHeader();

  if (!year) return;

  const sort = year.getAttribute("aria-sort");

  // Desired initial state reached.
  // Release control so the user can change sorting afterwards.
  if (sort === "descending") {
    sortClickPending = false;
    autoSortTargetPath = null;
    return;
  }

  if (sortClickPending) return;

  sortClickPending = true;

  year.click();

  setTimeout(() => {
    sortClickPending = false;
    ensureNewestFirst();
  }, 600);
}

/* --------------------------------------------------
   Sidebar positioning
-------------------------------------------------- */

function findCollectionElement() {
  return [
    ...document.querySelectorAll(
      'a, button, span, [role="button"]'
    )
  ].find(
    element =>
      element.textContent?.trim() ===
      "Collection"
  );
}

function findDirectChildContaining(
  parent,
  element
) {
  let current = element;

  while (
    current &&
    current.parentElement !== parent
  ) {
    current = current.parentElement;
  }

  return current;
}

/* --------------------------------------------------
   Sidebar UI
-------------------------------------------------- */

function makeEngineerButton(
  entry,
  wantedRole
) {
  const button =
    document.createElement("button");

  button.type = "button";
  button.className =
    "enzo-engineer-item";

  const label =
    document.createElement("span");

  label.textContent = entry.name;

  const arrow =
    document.createElement("span");

  arrow.className =
    "enzo-engineer-arrow";

  arrow.textContent = "›";

  button.append(label, arrow);

  button.addEventListener(
    "click",
    async event => {
      event.preventDefault();
      event.stopPropagation();

      if (
        button.dataset.loading === "true"
      ) {
        return;
      }

      button.dataset.loading = "true";

      arrow.textContent = "…";

      const id =
        await resolveContributor(
          entry,
          wantedRole
        );

      button.dataset.loading = "false";

      arrow.textContent = "›";

      if (id !== undefined) {
        openCredits(id);
      } else {
        arrow.textContent = "!";

        button.title =
          `Could not find ${entry.name} in TIDAL Credits`;

        setTimeout(() => {
          arrow.textContent = "›";
        }, 2000);
      }
    }
  );

  return button;
}

function makeGroup(group) {
  const wrapper =
    document.createElement("div");

  wrapper.className =
    "enzo-engineer-group";

  const heading =
    document.createElement("button");

  heading.type = "button";
  heading.className =
    "enzo-engineer-heading";

  const title =
    document.createElement("span");

  title.textContent = group.title;

  const chevron =
    document.createElement("span");

  chevron.className =
    "enzo-engineer-chevron";

  heading.append(title, chevron);

  const items =
    document.createElement("div");

  items.className =
    "enzo-engineer-items";

  for (const engineer of group.engineers) {
    items.appendChild(
      makeEngineerButton(
        engineer,
        group.role
      )
    );
  }

  function renderOpenState() {
    const open =
      openState[group.key];

    items.style.display =
      open ? "block" : "none";

    chevron.textContent =
      open ? "⌄" : "›";
  }

  heading.addEventListener(
    "click",
    () => {
      openState[group.key] =
        !openState[group.key];

      renderOpenState();
    }
  );

  renderOpenState();

  wrapper.append(
    heading,
    items
  );

  return wrapper;
}

function addStyles(root) {
  const style =
    document.createElement("style");

  style.textContent = `
    #${ROOT_ID} {
      box-sizing: border-box;
      width: 100%;
      padding: 5px 7px 7px;
      margin-top: 3px;
    }

    #${ROOT_ID} button {
      font-family: inherit;
    }

    .enzo-engineer-heading {
      width: 100%;
      height: 31px;
      padding: 0 8px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: rgba(255,255,255,.72);
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      text-align: left;
    }

    .enzo-engineer-heading:hover {
      color: white;
      background: rgba(255,255,255,.07);
    }

    .enzo-engineer-chevron {
      font-size: 16px;
      opacity: .7;
      line-height: 1;
    }

    .enzo-engineer-items {
      padding-bottom: 4px;
    }

    .enzo-engineer-item {
      width: 100%;
      min-height: 29px;
      padding: 0 8px 0 18px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: rgba(255,255,255,.66);
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      font-size: 12px;
      text-align: left;
    }

    .enzo-engineer-item:hover {
      color: white;
      background: rgba(255,255,255,.08);
    }

    .enzo-engineer-item[data-loading="true"] {
      opacity: .6;
    }

    .enzo-engineer-arrow {
      margin-left: 5px;
      opacity: .45;
    }
  `;

  root.appendChild(style);
}

function addSidebar() {
  if (
    document.getElementById(ROOT_ID)
  ) {
    return;
  }

  const feed =
    document.querySelector(
      '[data-test="sidebar-feed"]'
    );

  if (!feed) return;

  const feedRow =
    feed.closest("li") || feed;

  const parent =
    feedRow.parentElement;

  if (!parent) return;

  const root =
    document.createElement("div");

  root.id = ROOT_ID;

  addStyles(root);

  for (const group of groups) {
    root.appendChild(
      makeGroup(group)
    );
  }

  const collection =
    findCollectionElement();

  if (collection) {
    const collectionRow =
      findDirectChildContaining(
        parent,
        collection
      );

    if (collectionRow) {
      collectionRow.insertAdjacentElement(
        "afterend",
        root
      );

      return;
    }
  }

  feedRow.insertAdjacentElement(
    "afterend",
    root
  );
}

/* --------------------------------------------------
   Survive TIDAL SPA rerenders
-------------------------------------------------- */

function update() {
  addSidebar();
  ensureNewestFirst();
}

function scheduleUpdate() {
  if (updateScheduled) return;

  updateScheduled = true;

  requestAnimationFrame(() => {
    updateScheduled = false;
    update();
  });
}

const observer =
  new MutationObserver(
    scheduleUpdate
  );

observer.observe(
  document.documentElement,
  {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-sort"]
  }
);

unloads.add(
  () => observer.disconnect()
);

unloads.add(() => {
  document
    .getElementById(ROOT_ID)
    ?.remove();
});

update();

console.log(
  "[Engineer Credits] v2 loaded"
);
