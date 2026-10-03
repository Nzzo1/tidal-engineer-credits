const ROOT_ID = "enzo-engineer-credits";

export const unloads = new Set();

const Core =
  globalThis.luna?.core?.modules?.["@luna/core"] ??
  globalThis.luna?.core;

const React =
  globalThis.luna?.core?.modules?.["react"];

const DEFAULT_MIX_ENGINEERS = [
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
];

const DEFAULT_MASTERING_ENGINEERS = [
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
];

const storage = await Core.ReactiveStore.getPluginStorage(
  "EngineerCredits",
  {
    mixEngineers: DEFAULT_MIX_ENGINEERS,
    masteringEngineers: DEFAULT_MASTERING_ENGINEERS
  }
);

const groups = [
  {
    key: "mix",
    title: "Mix Engineers",
    role: "mix",
    get engineers() {
      return storage.mixEngineers ?? [];
    }
  },
  {
    key: "mastering",
    title: "Mastering Engineers",
    role: "master",
    get engineers() {
      return storage.masteringEngineers ?? [];
    }
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



/* --------------------------------------------------
   Luna plugin settings
-------------------------------------------------- */

function cloneEngineers(value) {
  return Array.from(value ?? []).map(item => ({
    name: String(item.name ?? ""),
    ...(item.id ? { id: Number(item.id) } : {})
  }));
}

function refreshSidebar() {
  document.getElementById(ROOT_ID)?.remove();
  addSidebar();
}

function saveEngineerGroup(kind, engineers) {
  const clean = cloneEngineers(engineers);

  if (kind === "mix") {
    storage.mixEngineers = clean;
  } else {
    storage.masteringEngineers = clean;
  }

  refreshSidebar();
}

function SettingsGroup({
  title,
  kind,
  engineers,
  setEngineers
}) {
  const h = React.createElement;

  const [name, setName] =
    React.useState("");

  const [id, setId] =
    React.useState("");

  const [error, setError] =
    React.useState("");

  const [dragIndex, setDragIndex] =
    React.useState(null);

  function addEngineer() {
    const numericId =
      Number(String(id).trim());

    if (
      !Number.isInteger(numericId) ||
      numericId <= 0
    ) {
      setError("Enter a valid TIDAL Credits ID.");
      return;
    }

    if (
      engineers.some(
        engineer =>
          Number(engineer.id) === numericId
      )
    ) {
      setError("That Credits ID is already in this category.");
      return;
    }

    const displayName =
      name.trim() ||
      `Credits ${numericId}`;

    const next = [
      ...engineers,
      {
        name: displayName,
        id: numericId
      }
    ];

    setEngineers(next);
    saveEngineerGroup(kind, next);

    setName("");
    setId("");
    setError("");
  }

  function moveEngineer(fromIndex, toIndex) {
    if (
      fromIndex === null ||
      fromIndex === toIndex
    ) {
      setDragIndex(null);
      return;
    }

    const next = [...engineers];

    const [moved] =
      next.splice(fromIndex, 1);

    next.splice(toIndex, 0, moved);

    setEngineers(next);
    saveEngineerGroup(kind, next);
    setDragIndex(null);
  }

  function removeEngineer(index) {
    const next =
      engineers.filter(
        (_, i) => i !== index
      );

    setEngineers(next);
    saveEngineerGroup(kind, next);
  }

  return h(
    "section",
    {
      style: {
        marginBottom: "28px"
      }
    },

    h(
      "h3",
      {
        style: {
          margin: "0 0 12px",
          fontSize: "16px"
        }
      },
      title
    ),

    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          marginBottom: "14px"
        }
      },

      ...engineers.map(
        (engineer, index) =>
          h(
            "div",
            {
              key:
                `${engineer.name}-${engineer.id ?? index}`,

              draggable: true,

              onDragStart: event => {
                setDragIndex(index);

                event.dataTransfer.effectAllowed =
                  "move";

                event.dataTransfer.setData(
                  "text/plain",
                  String(index)
                );
              },

              onDragOver: event => {
                event.preventDefault();

                event.dataTransfer.dropEffect =
                  "move";
              },

              onDrop: event => {
                event.preventDefault();

                const from =
                  Number(
                    event.dataTransfer.getData(
                      "text/plain"
                    )
                  );

                moveEngineer(from, index);
              },

              onDragEnd: () => {
                setDragIndex(null);
              },

              style: {
                display: "grid",
                gridTemplateColumns:
                  "28px minmax(160px, 1fr) 100px auto",
                gap: "10px",
                alignItems: "center",
                padding: "7px 9px",
                borderRadius: "7px",
                background:
                  dragIndex === index
                    ? "rgba(255,255,255,.10)"
                    : "rgba(255,255,255,.04)",
                opacity:
                  dragIndex === index
                    ? ".55"
                    : "1",
                cursor: "grab",
                transition:
                  "background .12s ease, opacity .12s ease"
              }
            },

            h(
              "span",
              {
                title: "Drag to reorder",
                style: {
                  opacity: ".45",
                  cursor: "grab",
                  fontSize: "16px",
                  userSelect: "none",
                  textAlign: "center"
                }
              },
              "☰"
            ),

            h(
              "span",
              null,
              engineer.name
            ),

            h(
              "code",
              {
                style: {
                  opacity: engineer.id
                    ? ".75"
                    : ".35"
                }
              },
              engineer.id ?? "auto"
            ),

            h(
              "button",
              {
                type: "button",
                onClick: () =>
                  removeEngineer(index),
                style: {
                  border: 0,
                  borderRadius: "6px",
                  padding: "6px 9px",
                  cursor: "pointer",
                  background:
                    "rgba(255,70,70,.15)",
                  color: "#ff8a8a"
                }
              },
              "Remove"
            )
          )
      )
    ),

    h(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns:
            "minmax(170px,1fr) 160px auto",
          gap: "8px",
          alignItems: "center"
        }
      },

      h("input", {
        value: name,
        placeholder: "Engineer name (optional)",
        onChange: event =>
          setName(event.target.value),
        style: {
          boxSizing: "border-box",
          width: "100%",
          height: "36px",
          borderRadius: "6px",
          border:
            "1px solid rgba(255,255,255,.15)",
          padding: "0 10px",
          background:
            "rgba(0,0,0,.20)",
          color: "inherit"
        }
      }),

      h("input", {
        value: id,
        placeholder: "Credits ID",
        inputMode: "numeric",
        onChange: event =>
          setId(event.target.value),
        onKeyDown: event => {
          if (event.key === "Enter") {
            addEngineer();
          }
        },
        style: {
          boxSizing: "border-box",
          width: "100%",
          height: "36px",
          borderRadius: "6px",
          border:
            "1px solid rgba(255,255,255,.15)",
          padding: "0 10px",
          background:
            "rgba(0,0,0,.20)",
          color: "inherit"
        }
      }),

      h(
        "button",
        {
          type: "button",
          onClick: addEngineer,
          style: {
            height: "36px",
            border: 0,
            borderRadius: "6px",
            padding: "0 15px",
            cursor: "pointer",
            fontWeight: "600"
          }
        },
        "Add"
      )
    ),

    error
      ? h(
          "div",
          {
            style: {
              marginTop: "8px",
              color: "#ff8a8a",
              fontSize: "12px"
            }
          },
          error
        )
      : null
  );
}

export const Settings = () => {
  if (!React) {
    return "React module unavailable.";
  }

  const h = React.createElement;

  const [mixEngineers, setMixEngineers] =
    React.useState(
      () =>
        cloneEngineers(
          storage.mixEngineers
        )
    );

  const [
    masteringEngineers,
    setMasteringEngineers
  ] =
    React.useState(
      () =>
        cloneEngineers(
          storage.masteringEngineers
        )
    );

  return h(
    "div",
    {
      style: {
        padding:
          "8px 4px 4px",
        maxWidth: "900px"
      }
    },

    h(
      "p",
      {
        style: {
          marginTop: 0,
          opacity: ".7",
          fontSize: "13px"
        }
      },
      "Add or remove TIDAL engineer Credits profiles. " +
      "The Credits ID is the number at the end of a TIDAL URL such as /credits/10470066."
    ),

    h(SettingsGroup, {
      title: "Mix Engineers",
      kind: "mix",
      engineers: mixEngineers,
      setEngineers:
        setMixEngineers
    }),

    h(SettingsGroup, {
      title: "Mastering Engineers",
      kind: "mastering",
      engineers:
        masteringEngineers,
      setEngineers:
        setMasteringEngineers
    })
  );
};

console.log(
  "[Engineer Credits] v2 loaded"
);
