const state = {
  products: [],
  selected: new Set(),
  query: "",
  sort: "name",
  filters: {
    brand: [],
    priceMin: "",
    priceMax: "",
    priceValues: [],
    stockMin: "",
    stockMax: "",
    stockValues: [],
    attributeRanges: {},
    attributeValues: {},
  },
  activeWorkspace: "manual",
  jlc: {
    categories: [],
    categoryId: "",
    subcategoryId: "",
    facets: null,
    facetRequestId: 0,
    facetsLoading: false,
    searching: false,
    searchTimer: null,
    currentPage: 1,
    pageSize: 25,
    total: null,
    pageProducts: null,
    selections: {},
    ranges: {},
    rangeAnchors: {},
    activeFacetKey: null,
    facetSearch: "",
  },
};

const byId = (id) => document.getElementById(id);
const rowsElement = byId("component-rows");
const statusElement = byId("status");

function setTheme(theme, persist = false) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  document.querySelector('meta[name="color-scheme"]').content = isDark ? "dark" : "light";
  const button = byId("theme-toggle");
  button.textContent = isDark ? "Light theme" : "Dark theme";
  button.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} theme`);
  if (persist) localStorage.setItem("jlc-parts-theme", isDark ? "dark" : "light");
}

const modalDialogs = [byId("compare-section"), byId("filters-dialog"), byId("jlc-facet-dialog")];

function syncModalScrollLock() {
  document.documentElement.classList.toggle(
    "modal-open",
    modalDialogs.some((dialog) => dialog.open)
  );
}

function showModal(dialog) {
  dialog.showModal();
  syncModalScrollLock();
}

for (const dialog of modalDialogs) {
  dialog.addEventListener("close", syncModalScrollLock);
}
byId("jlc-facet-dialog").addEventListener("close", () => {
  state.jlc.activeFacetKey = null;
  state.jlc.facetSearch = "";
  byId("jlc-facet-dialog-content").replaceChildren();
});

setTheme(localStorage.getItem("jlc-parts-theme") ?? "light");
byId("theme-toggle").addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  setTheme(nextTheme, true);
});

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

function productKey(product) {
  return product.componentCode || `${product.componentBrandEn ?? ""}:${product.componentModelEn ?? product.componentName}`;
}

function mergeProducts(incoming) {
  const existing = new Map(state.products.map((product) => [productKey(product), product]));
  let added = 0;

  for (const product of incoming) {
    const key = productKey(product);
    if (!existing.has(key)) added += 1;
    existing.set(key, product);
  }

  state.products = [...existing.values()];
  renderFilterControls();
  render();
  return added;
}

function setWorkspace(name) {
  state.activeWorkspace = name;
  const manual = name === "manual";
  document.body.classList.toggle("jlc-mode", !manual);
  byId("manual-workspace").classList.toggle("hidden", !manual);
  byId("jlc-workspace").classList.toggle("hidden", manual);
  byId("manual-tab").classList.toggle("active", manual);
  byId("jlc-tab").classList.toggle("active", !manual);
  byId("manual-tab").setAttribute("aria-selected", String(manual));
  byId("jlc-tab").setAttribute("aria-selected", String(!manual));
  byId("manual-tab").tabIndex = manual ? 0 : -1;
  byId("jlc-tab").tabIndex = manual ? -1 : 0;
  byId("page-count").textContent =
    !manual && state.jlc.total != null
      ? formatNumber(Math.ceil(state.jlc.total / state.jlc.pageSize))
      : "—";
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(number);
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(number);
}

function getPrice(product) {
  if (product.initialPrice == null || product.initialPrice === "") {
    const firstTier = product.componentPrices?.find(
      (item) => item.productPrice != null && Number.isFinite(Number(item.productPrice))
    );
    return firstTier ? Number(firstTier.productPrice) : Infinity;
  }
  const price = Number(product.initialPrice);
  if (Number.isFinite(price) && price >= 0) return price;
  const tier = product.componentPrices?.find((item) => Number.isFinite(Number(item.productPrice)));
  return tier ? Number(tier.productPrice) : Infinity;
}

function getAttributeMap(product) {
  return new Map(
    (product.attributes ?? [])
      .filter((attribute) => attribute?.attribute_name_en)
      .map((attribute) => [
        String(attribute.attribute_name_en).trim(),
        attribute.attribute_value_name == null ? "" : String(attribute.attribute_value_name),
      ])
  );
}

function parseMeasurement(value) {
  const match = String(value ?? "").match(
    /^\s*([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*([a-zA-ZµμΩ℃°%]*)(?:\s*(?:~|–|—)\s*([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*([a-zA-ZµμΩ℃°%]*))?(?:\s*@.*)?\s*$/
  );
  if (!match) return null;

  const prefixScale = {
    p: 1e-12,
    n: 1e-9,
    "µ": 1e-6,
    "μ": 1e-6,
    u: 1e-6,
    m: 1e-3,
    k: 1e3,
    K: 1e3,
    M: 1e6,
    G: 1e9,
  };
  const unitParts = (unit) => {
    const hasPrefixOnly = unit.length === 1 && Object.hasOwn(prefixScale, unit);
    const hasUnitPrefix = unit.length > 1 && Object.hasOwn(prefixScale, unit[0]);
    const baseUnit = hasPrefixOnly ? "" : hasUnitPrefix ? unit.slice(1) : unit;
    const canonicalUnits = new Map([
      ["a", "A"],
      ["v", "V"],
      ["f", "F"],
      ["h", "H"],
      ["w", "W"],
      ["hz", "Hz"],
      ["c", "C"],
      ["ohm", "Ω"],
      ["ω", "Ω"],
    ]);
    return {
      unit,
      baseUnit: canonicalUnits.get(baseUnit.toLocaleLowerCase()) ?? baseUnit,
      scale: hasPrefixOnly ? prefixScale[unit] : hasUnitPrefix ? prefixScale[unit[0]] : 1,
    };
  };
  const firstNumber = Number(match[1].replace(",", "."));
  const firstUnit = unitParts(match[2] ?? "");
  const secondNumber = match[3] == null ? firstNumber : Number(match[3].replace(",", "."));
  const secondUnit = unitParts(match[4] || firstUnit.unit);
  if (
    match[3] != null &&
    firstUnit.baseUnit &&
    secondUnit.baseUnit &&
    firstUnit.baseUnit !== secondUnit.baseUnit
  ) {
    return null;
  }
  const commonUnit = firstUnit.baseUnit ? firstUnit : secondUnit;
  const first = firstNumber * (firstUnit.unit ? firstUnit.scale : commonUnit.scale);
  const second = secondNumber * (match[4] ? secondUnit.scale : firstUnit.unit ? firstUnit.scale : commonUnit.scale);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  return {
    min: Math.min(first, second),
    max: Math.max(first, second),
    unit: commonUnit.unit,
    baseUnit: commonUnit.baseUnit,
    scale: commonUnit.scale,
  };
}

function parseMeasurements(value) {
  return String(value ?? "")
    .split(/[、，;|]+/)
    .map((part) => parseMeasurement(part.trim()))
    .filter(Boolean);
}

function numericAttribute(values) {
  const parsed = values.flatMap(parseMeasurements);
  if (parsed.length === 0 || parsed.length / values.length < 0.5) return null;
  const units = new Map();
  for (const measurement of parsed) {
    units.set(measurement.baseUnit, (units.get(measurement.baseUnit) ?? 0) + 1);
  }
  const commonUnit = [...units].sort((left, right) => right[1] - left[1])[0][0];
  return parsed.find((measurement) => measurement.baseUnit === commonUnit);
}

function passesRange(value, minimum, maximum) {
  if (minimum === "" && maximum === "") return true;
  if (value == null || value === "") return false;
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  const min = minimum === "" ? -Infinity : parseScalarBound(minimum);
  const max = maximum === "" ? Infinity : parseScalarBound(maximum);
  if (min == null || max == null) return false;
  return number >= min && number <= max;
}

function parseScalarBound(value) {
  const measurement = parseMeasurement(value);
  if (!measurement || measurement.baseUnit) return null;
  return measurement.min;
}

function passesMeasurementRange(value, range) {
  if (!range || (range.min === "" && range.max === "")) return true;
  const minimum = range.min === "" ? -Infinity : parseRangeBound(range.min, range);
  const maximum = range.max === "" ? Infinity : parseRangeBound(range.max, range);
  if (minimum == null || maximum == null || minimum > maximum) return false;
  const measurements = parseMeasurements(value);
  return measurements.length > 0 && measurements.every((measurement) => {
    if (measurement.baseUnit !== range.baseUnit) return false;
    const magnitude = Math.max(
      ...[minimum, maximum, measurement.min, measurement.max]
        .filter(Number.isFinite)
        .map(Math.abs),
      Number.MIN_VALUE
    );
    const tolerance = magnitude * Number.EPSILON * 16;
    return measurement.min + tolerance >= minimum &&
      measurement.max - tolerance <= maximum;
  });
}

function parseRangeBound(value, range) {
  const measurement = parseMeasurement(value);
  if (!measurement) return null;
  if (!measurement.baseUnit) return measurement.min;
  if (measurement.baseUnit !== range.baseUnit) return null;
  return measurement.min;
}

function keyAttributes(product) {
  const attributes = getAttributeMap(product);
  const selectedAttributes = Object.entries(state.jlc.selections)
    .filter(([name, values]) => !name.startsWith("__") && values.length)
    .map(([name]) => name);
  const preferred = [...new Set([
    ...selectedAttributes,
    "Type",
    "Maximum Continuous Current",
    "Current - Continuous Drain(Id)",
    "Drain to Source Voltage",
    "RDS(on)",
    "Voltage - Supply",
    "Operating Voltage",
    "Features",
  ])];

  return preferred
    .filter((name) => attributes.has(name) && attributes.get(name) && attributes.get(name) !== "-")
    .slice(0, 4)
    .map((name) => `${name}: ${attributes.get(name)}`);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function createProductImage(product) {
  const image = document.createElement("img");
  image.className = "product-image";
  image.src = product.imageUrl;
  image.alt = `${product.componentName || product.componentCode} image`;
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => {
    image.replaceWith(element("span", "image-placeholder", "—"));
  }, { once: true });
  return image;
}

function getVisibleProducts() {
  const query = state.query.trim().toLocaleLowerCase();
  const sourceProducts = state.activeWorkspace === "jlc" && state.jlc.pageProducts
    ? state.jlc.pageProducts
    : state.products;
  const products = sourceProducts.filter((product) => {
    const attributes = (product.attributes ?? [])
      .map((attribute) => `${attribute.attribute_name_en ?? ""} ${attribute.attribute_value_name ?? ""}`)
      .join(" ");
    const matchesQuery = !query || [
      product.componentName,
      product.componentBrandEn,
      product.componentCode,
      product.componentModelEn,
      product.componentSpecificationEn,
      product.describe,
      attributes,
    ].some((value) => String(value ?? "").toLocaleLowerCase().includes(query));
    if (!matchesQuery) return false;

    if (state.filters.brand.length && !state.filters.brand.includes(product.componentBrandEn ?? "")) {
      return false;
    }
    if (state.filters.priceValues.length && !state.filters.priceValues.includes(String(getPrice(product)))) {
      return false;
    }
    if (state.filters.stockValues.length && !state.filters.stockValues.includes(String(product.stockCount ?? ""))) {
      return false;
    }
    if (!passesRange(getPrice(product), state.filters.priceMin, state.filters.priceMax)) return false;
    if (!passesRange(product.stockCount, state.filters.stockMin, state.filters.stockMax)) return false;

    const attributeMap = getAttributeMap(product);
    for (const [name, range] of Object.entries(state.filters.attributeRanges)) {
      const selectedRange = range.min !== "" || range.max !== "";
      if (!selectedRange) continue;
      const values = attributeMap.get(name);
      if (!values || !passesMeasurementRange(values, range)) return false;
    }
    for (const [name, selectedValues] of Object.entries(state.filters.attributeValues)) {
      if (selectedValues.length && !selectedValues.includes(attributeMap.get(name) ?? "")) return false;
    }
    return true;
  });

  products.sort((left, right) => {
    switch (state.sort) {
      case "price-asc": return getPrice(left) - getPrice(right);
      case "price-desc": return getPrice(right) - getPrice(left);
      case "stock-desc": return Number(right.stockCount ?? 0) - Number(left.stockCount ?? 0);
      case "stock-asc": return Number(left.stockCount ?? 0) - Number(right.stockCount ?? 0);
      default:
        return String(left.componentName ?? "").localeCompare(
          String(right.componentName ?? ""),
          undefined,
          { sensitivity: "base" }
        );
    }
  });

  return products;
}

function makeProductRow(product) {
  const key = productKey(product);
  const row = document.createElement("tr");

  const selectionCell = document.createElement("td");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "compare-checkbox";
  checkbox.setAttribute("aria-label", `Select ${product.componentName} to compare`);
  checkbox.checked = state.selected.has(key);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked && state.selected.size >= 4) {
      checkbox.checked = false;
      setStatus("You can compare up to 4 components at a time.", true);
      return;
    }
    if (checkbox.checked) state.selected.add(key);
    else state.selected.delete(key);
    updateCounts();
  });
  selectionCell.append(checkbox);
  row.append(selectionCell);

  const imageCell = document.createElement("td");
  if (product.imageUrl) {
    imageCell.append(createProductImage(product));
  } else {
    imageCell.append(element("span", "image-placeholder", "—"));
  }
  row.append(imageCell);

  const nameCell = document.createElement("td");
  nameCell.append(
    element("span", "part-name", product.componentName || "Unnamed"),
    element("span", "part-model", product.componentModelEn || "")
  );
  row.append(nameCell);
  row.append(element("td", "brand-cell", product.componentBrandEn || "—"));

  const codeCell = document.createElement("td");
  codeCell.append(element("span", "code-pill", product.componentCode || "—"));
  row.append(codeCell);
  row.append(element("td", "package-cell", product.componentSpecificationEn || "—"));
  row.append(element("td", "description-cell", product.describe || "—"));
  row.append(element(
    "td",
    "price-cell",
    Number.isFinite(getPrice(product)) ? formatMoney(getPrice(product)) : "—"
  ));
  row.append(element("td", "stock-cell", product.stockCount == null ? "—" : formatNumber(product.stockCount)));

  const attributesCell = document.createElement("td");
  const chips = element("div", "attribute-chips");
  for (const text of keyAttributes(product)) {
    chips.append(element("span", "attribute-chip", text));
  }
  if (!chips.childElementCount) chips.append(element("span", "attribute-chip", "No key attributes"));
  attributesCell.append(chips);
  row.append(attributesCell);

  const linkCell = document.createElement("td");
  if (product.productUrl) {
    const link = element("a", "product-link", "↗");
    link.href = product.productUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.setAttribute("aria-label", `Open ${product.componentName}`);
    linkCell.append(link);
  } else {
    linkCell.textContent = "—";
  }
  row.append(linkCell);
  return row;
}

function render() {
  const visible = getVisibleProducts();
  rowsElement.replaceChildren();

  if (!visible.length) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 11;
    cell.append(
      element("span", "empty-icon", sourceHasProducts() ? "⌕" : "⌁"),
      element("strong", "", sourceHasProducts() ? "No results for this search" : "No components yet"),
      element("span", "", sourceHasProducts() ? "Try another name, code, or attribute." : "Import a JSON file or add a product by URL to get started.")
    );
    row.append(cell);
    rowsElement.append(row);
  } else {
    rowsElement.append(...visible.map(makeProductRow));
  }

  byId("total-count").textContent = formatNumber(
    state.activeWorkspace === "jlc" && state.jlc.total != null
      ? state.jlc.total
      : state.products.length
  );
  byId("visible-count").textContent = formatNumber(visible.length);
  byId("compare-count").textContent = `${state.selected.size} / 4`;
  byId("page-count").textContent =
    state.activeWorkspace === "jlc" && state.jlc.total != null
      ? formatNumber(Math.ceil(state.jlc.total / state.jlc.pageSize))
      : "—";
  byId("download-button").disabled = state.products.length === 0;
  byId("clear-button").disabled = state.products.length === 0;
  byId("compare-button").disabled = state.selected.size < 2;
  renderCatalogPagination();
}

function sourceHasProducts() {
  return state.activeWorkspace === "jlc" && state.jlc.pageProducts
    ? state.jlc.pageProducts.length > 0
    : state.products.length > 0;
}

function renderCatalogPagination() {
  const container = byId("catalog-pagination");
  const total = state.jlc.total;
  const pageSize = state.jlc.pageSize;
  const totalPages = total == null ? 0 : Math.ceil(total / pageSize);
  container.replaceChildren();
  container.classList.toggle(
    "hidden",
    state.activeWorkspace !== "jlc" || state.jlc.pageProducts == null || totalPages <= 1
  );
  if (container.classList.contains("hidden")) return;

  const addButton = (label, page, { disabled = false, current = false, ariaLabel = label } = {}) => {
    const button = element("button", `page-button${current ? " current" : ""}`, label);
    button.type = "button";
    button.disabled = disabled || state.jlc.searching;
    button.setAttribute("aria-label", ariaLabel);
    if (current) button.setAttribute("aria-current", "page");
    button.addEventListener("click", () => void loadJlcPage(page));
    container.append(button);
  };

  addButton("‹", Math.max(1, state.jlc.currentPage - 1), {
    disabled: state.jlc.currentPage <= 1,
    ariaLabel: "Previous page",
  });
  const first = Math.max(1, Math.min(
    state.jlc.currentPage - 2,
    totalPages - 4
  ));
  const last = Math.min(totalPages, first + 4);
  if (first > 1) {
    addButton("1", 1, { current: state.jlc.currentPage === 1 });
    if (first > 2) container.append(element("span", "page-ellipsis", "…"));
  }
  for (let page = first; page <= last; page += 1) {
    addButton(String(page), page, { current: page === state.jlc.currentPage });
  }
  if (last < totalPages) {
    if (last < totalPages - 1) container.append(element("span", "page-ellipsis", "…"));
    addButton(String(totalPages), totalPages, { current: state.jlc.currentPage === totalPages });
  }
  addButton("›", Math.min(totalPages, state.jlc.currentPage + 1), {
    disabled: state.jlc.currentPage >= totalPages,
    ariaLabel: "Next page",
  });
  container.append(element(
    "span",
    "page-summary",
    `Page ${formatNumber(state.jlc.currentPage)} of ${formatNumber(totalPages)}`
  ));
}

function updateCounts() {
  byId("compare-count").textContent = `${state.selected.size} / 4`;
  byId("compare-button").disabled = state.selected.size < 2;
}

function updateActiveFilterCount() {
  const count =
    state.filters.brand.length +
    Number(state.filters.priceMin !== "") +
    Number(state.filters.priceMax !== "") +
    Number(state.filters.priceValues.length > 0) +
    Number(state.filters.stockMin !== "") +
    Number(state.filters.stockMax !== "") +
    Number(state.filters.stockValues.length > 0) +
    Object.values(state.filters.attributeRanges).filter(
      (range) => range.min !== "" || range.max !== ""
    ).length +
    Object.values(state.filters.attributeValues).filter((values) => values.length > 0).length;
  byId("active-filter-count").textContent = `${count} active`;
  byId("open-filters").setAttribute(
    "aria-label",
    `Open catalog filters, ${count} active`
  );
}

function createFilterGroup(label, className = "") {
  const group = element("div", `filter-control ${className}`.trim());
  group.append(element("span", "filter-label", label));
  return group;
}

function addRangeInputs(group, minimum, maximum, onChange, unit = "") {
  const inputs = element("div", "range-inputs");
  const reference = group.rangeReference;
  for (const [bound, value, placeholder] of [
    ["min", minimum, "Min (e.g. 1k)"],
    ["max", maximum, "Max (e.g. 1000)"],
  ]) {
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.value = value;
    input.placeholder = placeholder;
    input.title = unit
      ? `Use ${unit}, SI prefixes (m, u, n, k), or an equivalent unit.`
      : "Accepts numbers and unit suffixes such as k, m, u, or n.";
    input.setAttribute("aria-label", `${group.querySelector(".filter-label").textContent} ${placeholder.toLowerCase()}`);
    input.addEventListener("input", () => onChange(bound, input.value));
    inputs.append(input);
  }
  if (unit) {
    const unitLabel = element("span", "range-unit", unit);
    unitLabel.title = reference?.baseUnit
      ? `Base unit: ${reference.baseUnit}; equivalent units can also be entered in this field.`
      : "Unit detected from catalog values.";
    inputs.append(unitLabel);
  }
  group.append(inputs);
}

function getFacetOptions(values, formatLabel = (value) => value) {
  const counts = new Map();
  for (const value of values) {
    if (value == null || value === "" || !Number.isFinite(Number(value))) {
      if (value == null || value === "") continue;
    }
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count, label: formatLabel(value) }))
    .sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" })
    );
}

function addValueSelector(group, options, selected, onChange, rangeKey = null) {
  const search = document.createElement("input");
  search.type = "search";
  search.className = "filter-search";
  search.placeholder = "Search values…";
  search.autocomplete = "off";
  search.setAttribute("aria-label", `Search ${group.querySelector(".filter-label").textContent}`);
  const list = element("div", "filter-value-list");
  for (const option of options) {
    const label = element("label", "filter-value-option");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = option.value;
    checkbox.checked = selected.includes(option.value);
    checkbox.title = "Select multiple options; Shift-click selects a range";
    const text = element("span", "filter-value-label", option.label || "No value");
    const count = element("span", "filter-value-count", formatNumber(option.count));
    count.title = `${formatNumber(option.count)} components`;
    label.append(checkbox, text, count);
    let shiftClick = false;
    label.addEventListener("pointerdown", (event) => {
      shiftClick = event.shiftKey;
    });
    checkbox.addEventListener("click", (event) => {
      shiftClick = shiftClick || event.shiftKey;
    });
    checkbox.addEventListener("change", () => {
      const anchorValue = rangeKey ? state.jlc.rangeAnchors[rangeKey] : list.rangeAnchor;
      if (shiftClick && anchorValue != null) {
        const visibleCheckboxes = [...list.querySelectorAll(".filter-value-option:not([hidden]) input")];
        const anchorIndex = visibleCheckboxes.findIndex((item) => item.value === anchorValue);
        const targetIndex = visibleCheckboxes.indexOf(checkbox);
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const start = Math.min(anchorIndex, targetIndex);
          const end = Math.max(anchorIndex, targetIndex);
          for (const rangeCheckbox of visibleCheckboxes.slice(start, end + 1)) {
            rangeCheckbox.checked = true;
          }
        }
      }
      if (!shiftClick || anchorValue == null) {
        if (rangeKey) state.jlc.rangeAnchors[rangeKey] = checkbox.value;
        else list.rangeAnchor = checkbox.value;
      }
      shiftClick = false;
      const selectedValues = [...list.querySelectorAll("input:checked")].map((input) => input.value);
      onChange(selectedValues);
    });
    list.append(label);
  }
  search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase();
    for (const option of list.children) {
      option.hidden = !option.textContent.toLocaleLowerCase().includes(query);
    }
  });
  group.append(search, list);
}

function normalizeFacetOptions(items) {
  return (items ?? [])
    .filter((item) => item && item.key != null)
    .map((item) => ({
      value: String(item.key),
      label: String(item.name ?? item.key),
      count: Number(item.docCount ?? 0),
      facet: item,
    }));
}

function jlcFacetItems(facet) {
  return normalizeFacetOptions(facet.subAggs);
}

function updateJlcFacetSummary() {
  const selectionKeys = new Set([
    ...Object.keys(state.jlc.selections),
    ...Object.keys(state.jlc.ranges),
  ]);
  const facetFilters = [...selectionKeys].reduce((count, key) => {
    const range = state.jlc.ranges[key];
    if (range && (range.min !== "" || range.max !== "")) return count + 1;
    return count + (state.jlc.selections[key]?.length ?? 0);
  }, 0);
  const activeFilters = facetFilters +
    Number(byId("jlc-library-basic").checked) +
    Number(byId("jlc-library-extended").checked) +
    Number(byId("jlc-availability").value !== "") +
    Number(byId("jlc-pcba-type").value !== "");
  const total = state.jlc.facets?.total;
  byId("jlc-facet-summary").textContent = state.jlc.facets
    ? `${state.jlc.facets.paramRangeList.length} available attributes · ${total == null ? "total unavailable" : `${formatNumber(total)} estimated results`
    } · ${activeFilters} ${activeFilters === 1 ? "JLC filter selected" : "JLC filters selected"}`
    : "";
  for (const button of byId("jlc-filter-controls").querySelectorAll(".jlc-facet-open")) {
    const key = button.dataset.facetKey;
    const selectedCount = state.jlc.selections[key]?.length ?? 0;
    const range = state.jlc.ranges[key];
    const rangeActive = range && (range.min !== "" || range.max !== "");
    const optionCount = button.dataset.optionCount;
    button.querySelector(".jlc-facet-meta").textContent =
      `${selectedCount ? `${formatNumber(selectedCount)} selected` : `${formatNumber(optionCount)} options`}${rangeActive ? " · range active" : ""}`;
  }
  if (byId("jlc-facet-dialog").open && state.jlc.activeFacetKey != null) {
    const optionCount = byId("jlc-facet-dialog-content").querySelectorAll(".filter-value-option").length;
    const selectedCount = state.jlc.selections[state.jlc.activeFacetKey]?.length ?? 0;
    byId("jlc-facet-dialog-count").textContent =
      `${formatNumber(optionCount)} options · ${formatNumber(selectedCount)} selected`;
  }
  renderJlcSelectedFilters();
}

function renderJlcSelectedFilters() {
  const container = byId("jlc-selected-filters");
  container.replaceChildren();
  const facetNames = new Map([
    ["__brands", "JLCPCB brand"],
    ["__packages", "JLCPCB package"],
    ...(state.jlc.facets?.paramRangeList ?? []).map((facet) => [facet.key, facet.name ?? facet.key]),
  ]);
  const selectedKeys = Object.keys(state.jlc.selections);
  const valuesByKey = new Map(selectedKeys.map((key) => {
    if (key === "__brands") return [key, normalizeFacetOptions(state.jlc.facets?.componentBrandList)];
    if (key === "__packages") return [key, normalizeFacetOptions(state.jlc.facets?.componentSpecificationList)];
    const facet = state.jlc.facets?.paramRangeList.find((item) => item.key === key);
    return [key, facet ? jlcFacetItems(facet) : []];
  }));
  const filterKeys = new Set([...Object.keys(state.jlc.selections), ...Object.keys(state.jlc.ranges)]);
  for (const key of filterKeys) {
    const values = state.jlc.selections[key] ?? [];
    const range = state.jlc.ranges[key];
    const rangeActive = range && (range.min !== "" || range.max !== "");
    if (!values.length && !rangeActive) continue;
    const options = valuesByKey.get(key) ?? [];
    const entries = values.map((value) => ({
      text: options.find((option) => option.value === value)?.label ?? value,
      remove: () => {
        if (rangeActive) {
          range.min = "";
          range.max = "";
        }
        state.jlc.selections[key] = values.filter((item) => item !== value);
        renderJlcFacetControls();
        updateJlcFacetSummary();
        scheduleJlcSearch();
      },
    }));
    if (rangeActive) {
      const bounds = [
        range.min === "" ? "" : `from ${range.min}`,
        range.max === "" ? "" : `to ${range.max}`,
      ].filter(Boolean).join(" ");
      entries.unshift({
        text: `Rango: ${bounds}`,
        remove: () => {
          range.min = "";
          range.max = "";
          renderJlcFacetControls();
          updateJlcFacetSummary();
          scheduleJlcSearch();
        },
        range: true,
      });
    }
    appendJlcFilterGroup(
      container,
      facetNames.get(key) ?? key,
      entries,
      () => {
        state.jlc.selections[key] = [];
        if (range) {
          range.min = "";
          range.max = "";
        }
        renderJlcFacetControls();
        updateJlcFacetSummary();
        scheduleJlcSearch();
      }
    );
  }
  for (const [id, label] of [
    ["jlc-library-basic", "Basic"],
    ["jlc-library-extended", "Extended"],
  ]) {
    const control = byId(id);
    if (!control.checked) continue;
    appendJlcFilterChip(container, `Biblioteca: ${label}`, () => {
      control.checked = false;
      updateJlcFacetSummary();
      scheduleJlcSearch();
    });
  }
  const availability = byId("jlc-availability");
  if (availability.value) {
    appendJlcFilterChip(
      container,
      `Availability: ${availability.selectedOptions[0].textContent}`,
      () => {
        availability.value = "";
        updateJlcFacetSummary();
        scheduleJlcSearch();
      }
    );
  }
  const pcbaType = byId("jlc-pcba-type");
  if (pcbaType.value) {
    appendJlcFilterChip(
      container,
      `Montaje: ${pcbaType.selectedOptions[0].textContent}`,
      () => {
        pcbaType.value = "";
        updateJlcFacetSummary();
        scheduleJlcSearch();
      }
    );
  }
}

function appendJlcFilterChip(container, text, remove) {
  const chip = element("button", "selected-filter-chip", "");
  chip.type = "button";
  chip.setAttribute("aria-label", `Remove filter ${text}`);
  chip.append(
    element("span", "", text),
    element("span", "selected-filter-remove", "×")
  );
  chip.addEventListener("click", remove);
  container.append(chip);
}

function appendJlcFilterGroup(container, name, entries, clear) {
  const group = element("div", "selected-filter-group");
  const trigger = element("button", "selected-filter-chip", "");
  trigger.type = "button";
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", `${name}: ${entries.length} selected values`);
  trigger.append(
    element("span", "", `${name} (${entries.filter((entry) => !entry.range).length})`),
    element("span", "selected-filter-caret", "▾")
  );
  trigger.addEventListener("click", () => {
    trigger.setAttribute("aria-expanded", String(trigger.getAttribute("aria-expanded") !== "true"));
  });
  trigger.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    clear();
  });
  const menu = element("div", "selected-filter-menu");
  menu.setAttribute("role", "list");
  for (const entry of entries) {
    const row = element("div", `selected-filter-entry${entry.range ? " range-entry" : ""}`);
    row.setAttribute("role", "listitem");
    row.append(element("span", "", entry.text));
    const remove = element("button", "selected-filter-remove-button", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${entry.text} from ${name}`);
    remove.addEventListener("click", entry.remove);
    row.append(remove);
    menu.append(row);
  }
  const clearButton = element("button", "selected-filter-clear", "Remove all");
  clearButton.type = "button";
  clearButton.addEventListener("click", clear);
  menu.append(clearButton);
  group.append(trigger, menu);
  container.append(group);
}

function jlcCategorySlug(name) {
  return name.replace(/\s*-\s*/g, "_").replace(/[\\/]/g, "_").replace(/\s+/g, "_");
}

function appendJlcFacetGroup(container, label, options, key, numeric = null) {
  const card = element("div", "jlc-facet-card");
  const count = state.jlc.selections[key]?.length ?? 0;
  const range = state.jlc.ranges[key];
  const rangeActive = range && (range.min !== "" || range.max !== "");
  const button = element("button", "jlc-facet-open", "");
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-label", `Expand filter ${label}`);
  button.dataset.facetKey = key;
  button.dataset.optionCount = String(options.length);
  button.append(
    element("span", "jlc-facet-name", label),
    element("span", "jlc-facet-meta",
      `${count ? `${formatNumber(count)} selected` : `${formatNumber(options.length)} options`}${rangeActive ? " · range active" : ""}`),
    element("span", "jlc-facet-expand", "Expand ↗")
  );
  button.addEventListener("click", () => {
    state.jlc.activeFacetKey = key;
    state.jlc.facetSearch = "";
    renderJlcFacetDialog();
    if (!byId("jlc-facet-dialog").open) showModal(byId("jlc-facet-dialog"));
  });
  card.append(button);
  container.append(card);
}

function createJlcFacetControl(label, options, key, numeric = null) {
  const group = createFilterGroup(label, numeric ? "range-filter" : "");
  if (numeric) {
    const range = state.jlc.ranges[key] ?? {
      min: "",
      max: "",
      scale: numeric.scale,
      unit: numeric.unit,
      baseUnit: numeric.baseUnit,
    };
    range.scale = numeric.scale;
    range.unit = numeric.unit;
    range.baseUnit = numeric.baseUnit;
    state.jlc.ranges[key] = range;
    if (range.min !== "" || range.max !== "") {
      state.jlc.selections[key] = options
        .filter((option) => passesMeasurementRange(option.value, range))
        .map((option) => option.value);
    }
    group.rangeReference = range;
    addRangeInputs(group, range.min, range.max, (bound, value) => {
      range[bound] = value;
      updateJlcFacetSummary();
      scheduleJlcSearch();
    }, numeric.unit);
  }
  const initial = state.jlc.selections[key] ?? [];
  addValueSelector(group, options, initial, (selected) => {
    state.jlc.selections[key] = selected;
    if (numeric) {
      const range = state.jlc.ranges[key];
      range.min = "";
      range.max = "";
      for (const input of group.querySelectorAll(".range-inputs input")) input.value = "";
    }
    updateJlcFacetSummary();
    scheduleJlcSearch();
  }, key);
  if (numeric) {
    const checkboxes = [...group.querySelectorAll(".filter-value-list input")];
    const rangeInputs = [...group.querySelectorAll(".range-inputs input")];
    for (const input of rangeInputs) {
      input.addEventListener("input", () => {
        const range = state.jlc.ranges[key];
        const isActive = range.min !== "" || range.max !== "";
        const selected = isActive
          ? options.filter((option) => passesMeasurementRange(option.value, range)).map((option) => option.value)
          : [];
        state.jlc.selections[key] = selected;
        checkboxes.forEach((checkbox) => {
          checkbox.checked = selected.includes(checkbox.value);
        });
        updateJlcFacetSummary();
      });
    }
  }
  return group;
}

function renderJlcFacetDialog() {
  const facets = state.jlc.facets;
  const key = state.jlc.activeFacetKey;
  const dialog = byId("jlc-facet-dialog");
  const host = byId("jlc-facet-dialog-content");
  if (!facets || key == null) return;

  let label;
  let options;
  if (key === "__brands") {
    label = "JLCPCB brand";
    options = normalizeFacetOptions(facets.componentBrandList);
  } else if (key === "__packages") {
    label = "JLCPCB package";
    options = normalizeFacetOptions(facets.componentSpecificationList);
  } else {
    const facet = facets.paramRangeList.find((item) => item.key === key);
    if (!facet) {
      dialog.close();
      return;
    }
    label = facet.name ?? facet.key;
    options = jlcFacetItems(facet);
  }

  byId("jlc-facet-dialog-title").textContent = label;
  byId("jlc-facet-dialog-count").textContent =
    `${formatNumber(options.length)} options · ${formatNumber(state.jlc.selections[key]?.length ?? 0)} selected`;
  const numeric = key.startsWith("__") ? null : numericAttribute(options.map((option) => option.value));
  host.replaceChildren(createJlcFacetControl(label, options, key, numeric));
  const search = host.querySelector(".filter-search");
  if (search) {
    search.value = state.jlc.facetSearch;
    search.dispatchEvent(new Event("input"));
    search.addEventListener("input", () => {
      state.jlc.facetSearch = search.value;
    });
  }
}

function renderJlcFacetControls() {
  const container = byId("jlc-filter-controls");
  container.replaceChildren();
  const facets = state.jlc.facets;
  if (!facets) {
    updateJlcFacetSummary();
    return;
  }

  const brands = normalizeFacetOptions(facets.componentBrandList);
  appendJlcFacetGroup(container, "JLCPCB brand", brands, "__brands");

  const packages = normalizeFacetOptions(facets.componentSpecificationList);
  appendJlcFacetGroup(container, "JLCPCB package", packages, "__packages");

  for (const facet of facets.paramRangeList) {
    const options = jlcFacetItems(facet);
    if (!options.length) continue;
    const measurement = numericAttribute(options.map((option) => option.value));
    appendJlcFacetGroup(container, facet.name ?? facet.key, options, facet.key, measurement);
  }
  if (byId("jlc-facet-dialog").open) renderJlcFacetDialog();
  updateJlcFacetSummary();
}

function buildJlcQuery() {
  const advancedPayload = byId("jlc-query").value.trim();
  let query;
  if (advancedPayload) {
    try {
      query = JSON.parse(advancedPayload);
    } catch {
      throw new Error("The advanced search payload must be valid JSON.");
    }
    if (!query || typeof query !== "object" || Array.isArray(query)) {
      throw new Error("The advanced search payload must be a JSON object.");
    }
  } else {
    const category = state.jlc.categories.find((item) => String(item.id) === state.jlc.categoryId);
    if (!category) throw new Error("Select a JLCPCB category first.");
    const subcategory = category.children.find(
      (item) => String(item.id) === state.jlc.subcategoryId
    );
    query = {
      currentPage: 1,
      pageSize: Number(byId("jlc-page-size").value) || 25,
      keyword: null,
      componentLibraryType: null,
      stockFlag: null,
      stockSort: null,
      firstSortName: category.name,
      secondSortName: subcategory?.name ?? "",
      searchSource: "search",
      searchType: 3,
      sortASC: "",
      sortMode: "",
      componentBrandList: [],
      componentSpecificationList: [],
      componentAttributeList: [],
      paramList: [],
      startStockNumber: null,
      firstSortId: category.id,
      secondSortId: subcategory?.id ?? null,
      firstSortNameNew: jlcCategorySlug(category.name),
      secondSortNameNew: subcategory ? jlcCategorySlug(subcategory.name) : "",
      firstSortNameList: [],
    };
  }

  const keyword = byId("jlc-keyword").value.trim();
  query.keyword = keyword || query.keyword || null;
  const libraryTypes = [
    byId("jlc-library-basic").checked ? "base" : null,
    byId("jlc-library-extended").checked ? "extended" : null,
  ].filter(Boolean);
  query.componentLibraryType = libraryTypes.length === 1 ? libraryTypes[0] : null;
  query.componentLibTypes = libraryTypes;
  const [sortMode, sortASC] = byId("jlc-sort").value.split(":");
  query.sortMode = sortMode;
  query.sortASC = sortASC;
  const availability = byId("jlc-availability").value;
  query.presaleTypes = availability === "stock"
    ? ["stock"]
    : availability === "presale"
      ? ["stock", "presale"]
      : [];
  query.pcbAType = byId("jlc-pcba-type").value === ""
    ? null
    : Number(byId("jlc-pcba-type").value);
  if (advancedPayload && state.jlc.categoryId) {
    const category = state.jlc.categories.find((item) => String(item.id) === state.jlc.categoryId);
    const subcategory = category?.children.find(
      (item) => String(item.id) === state.jlc.subcategoryId
    );
    if (category) {
      query.firstSortId = category.id;
      query.firstSortName = category.name;
      query.firstSortNameNew = jlcCategorySlug(category.name);
      query.secondSortId = subcategory?.id ?? null;
      query.secondSortName = subcategory?.name ?? "";
      query.secondSortNameNew = subcategory
        ? jlcCategorySlug(subcategory.name)
        : "";
    }
  }
  if (!Array.isArray(query.componentAttributeList)) query.componentAttributeList = [];

  const attributeValues = new Map();
  for (const item of query.componentAttributeList) {
    if (!item || typeof item !== "object") continue;
    for (const [name, values] of Object.entries(item)) {
      if (Array.isArray(values)) attributeValues.set(name, values.map(String));
    }
  }
  for (const item of Array.isArray(query.paramList) ? query.paramList : []) {
    if (item?.paramName && Array.isArray(item.paramValueList)) {
      attributeValues.set(item.paramName, item.paramValueList.map(String));
    }
  }

  for (const facet of state.jlc.facets?.paramRangeList ?? []) {
    const key = facet.key;
    const range = state.jlc.ranges[key];
    const minMaxActive = range && (range.min !== "" || range.max !== "");
    const selected = new Set(state.jlc.selections[key] ?? []);
    if (minMaxActive) {
      const reference = numericAttribute(jlcFacetItems(facet).map((option) => option.value));
      for (const option of jlcFacetItems(facet)) {
        if (reference && passesMeasurementRange(option.value, range)) selected.add(option.value);
      }
    }
    if (selected.size) {
      attributeValues.set(key, [...selected]);
    }
  }

  query.componentAttributeList = [
    ...query.componentAttributeList.filter((item) =>
      item && typeof item === "object" &&
      !Object.keys(item).some((name) => state.jlc.facets?.paramRangeList.some((facet) => facet.key === name))
    ),
    ...[...attributeValues].map(([name, values]) => ({ [name]: values })),
  ];
  const paramValues = new Map();
  for (const item of Array.isArray(query.paramList) ? query.paramList : []) {
    if (item?.paramName && Array.isArray(item.paramValueList)) {
      paramValues.set(item.paramName, item.paramValueList.map(String));
    }
  }
  for (const [name, values] of attributeValues) paramValues.set(name, values);
  query.paramList = [...paramValues].map(([paramName, paramValueList]) => ({
    paramName,
    paramValueList,
  }));
  const brandSelection = state.jlc.selections.__brands ?? [];
  const packageSelection = state.jlc.selections.__packages ?? [];
  if (brandSelection.length) query.componentBrandList = brandSelection;
  if (packageSelection.length) query.componentSpecificationList = packageSelection;
  return query;
}

function renderFilterControls() {
  const container = byId("filter-controls");
  if (!container) return;
  container.replaceChildren();

  const brands = getFacetOptions(state.products.map((product) => product.componentBrandEn));
  const brandGroup = createFilterGroup("Brand");
  addValueSelector(brandGroup, brands, state.filters.brand, (values) => {
    state.filters.brand = values;
    updateActiveFilterCount();
    render();
  });
  container.append(brandGroup);

  for (const [label, minimumKey, maximumKey, valuesKey, values] of [
    [
      "Unit price (USD)",
      "priceMin",
      "priceMax",
      "priceValues",
      getFacetOptions(
        state.products.map((product) => getPrice(product)).filter(Number.isFinite),
        (value) => formatMoney(Number(value))
      ),
    ],
    [
      "Stock",
      "stockMin",
      "stockMax",
      "stockValues",
      getFacetOptions(state.products.map((product) => product.stockCount).filter((value) =>
        value != null && Number.isFinite(Number(value))
      ), (value) => formatNumber(Number(value))),
    ],
  ]) {
    const group = createFilterGroup(label);
    group.classList.add("range-filter");
    addRangeInputs(
      group,
      state.filters[minimumKey],
      state.filters[maximumKey],
      (bound, value) => {
        state.filters[bound === "min" ? minimumKey : maximumKey] = value;
        updateActiveFilterCount();
        render();
      }
    );
    addValueSelector(group, values, state.filters[valuesKey], (selected) => {
      state.filters[valuesKey] = selected;
      updateActiveFilterCount();
      render();
    });
    container.append(group);
  }

  const attributeNames = [...new Set(
    state.products.flatMap((product) => [...getAttributeMap(product).keys()])
  )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  for (const name of attributeNames) {
    const values = getFacetOptions(
      state.products.map((product) => getAttributeMap(product).get(name)).filter(Boolean)
    );
    const measurement = numericAttribute(values);
    const group = createFilterGroup(name, "attribute-filter");
    if (measurement) {
      const range = state.filters.attributeRanges[name] ?? {
        min: "",
        max: "",
        scale: measurement.scale,
        unit: measurement.unit,
        baseUnit: measurement.baseUnit,
      };
      range.scale = measurement.scale;
      range.unit = measurement.unit;
      range.baseUnit = measurement.baseUnit;
      state.filters.attributeRanges[name] = range;
      group.rangeReference = range;
      addRangeInputs(group, range.min, range.max, (bound, value) => {
        range[bound] = value;
        updateActiveFilterCount();
        render();
      }, measurement.unit);
      group.append(element(
        "span",
        "filter-hint",
        "Use units and prefixes (1kΩ = 1000Ω; 100nF = 0.1uF). Values without a unit use the base unit."
      ));
    }
    addValueSelector(group, values, state.filters.attributeValues[name] ?? [], (selected) => {
      state.filters.attributeValues[name] = selected;
      updateActiveFilterCount();
      render();
    });
    container.append(group);
  }
  updateActiveFilterCount();
}

async function readApiResponse(response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP error ${response.status}`);
  return result;
}

function updateJlcSearchControls() {
  const hasCategory = Boolean(state.jlc.categoryId);
  const hasAdvancedPayload = Boolean(byId("jlc-query").value.trim());
  byId("load-jlc-facets").disabled =
    (!hasCategory && !hasAdvancedPayload) || state.jlc.facetsLoading || state.jlc.searching;
  byId("run-jlc-search").disabled =
    (!hasCategory && !hasAdvancedPayload) || state.jlc.facetsLoading || state.jlc.searching;
}

async function loadJlcCategories() {
  const categorySelect = byId("jlc-category");
  try {
    const result = await readApiResponse(await fetch("/api/jlc/categories"));
    state.jlc.categories = result.categories;
    categorySelect.replaceChildren(new Option("Select a category", ""));
    for (const category of result.categories) {
      categorySelect.add(new Option(
        `${category.name} (${formatNumber(category.count)})`,
        String(category.id)
      ));
    }
    categorySelect.disabled = false;
    setStatus(`${result.categories.length} categories loaded from JLCPCB.`);
  } catch (error) {
    categorySelect.replaceChildren(new Option("Could not load categories", ""));
    setStatus(error.message, true);
  }
}

async function loadJlcFacets() {
  const requestId = ++state.jlc.facetRequestId;
  state.jlc.facetsLoading = true;
  updateJlcSearchControls();
  setStatus("Refreshing available JLCPCB filters…");
  try {
    const result = await readApiResponse(
      await fetch("/api/jlc/facets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: buildJlcQuery() }),
      })
    );
    if (requestId !== state.jlc.facetRequestId) return;
    state.jlc.facets = result;
    renderJlcFacetControls();
    setStatus(`Filters updated: ${result.paramRangeList.length} attributes available.`);
  } catch (error) {
    if (requestId === state.jlc.facetRequestId) setStatus(error.message, true);
  } finally {
    if (requestId === state.jlc.facetRequestId) {
      state.jlc.facetsLoading = false;
      updateJlcSearchControls();
    }
  }
}

function scheduleJlcSearch() {
  clearTimeout(state.jlc.searchTimer);
  if (!state.jlc.categoryId && !byId("jlc-query").value.trim()) return;
  if (state.jlc.searching || state.jlc.facetsLoading) {
    state.jlc.facetRequestId += 1;
    state.jlc.searching = false;
    state.jlc.facetsLoading = false;
    updateJlcSearchControls();
  }
  state.jlc.searchTimer = setTimeout(() => {
    void runJlcSearch();
  }, 650);
}

async function runJlcSearch(scrollToCatalog = false) {
  clearTimeout(state.jlc.searchTimer);
  const requestId = ++state.jlc.facetRequestId;
  state.jlc.facetsLoading = false;
  state.jlc.searching = true;
  updateJlcSearchControls();
  setStatus("Updating filters and querying JLCPCB…");
  try {
    const query = buildJlcQuery();
    const facets = await readApiResponse(
      await fetch("/api/jlc/facets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      })
    );
    if (requestId !== state.jlc.facetRequestId) return;
    state.jlc.facets = facets;
    renderJlcFacetControls();
    const result = await readApiResponse(
      await fetch("/api/jlc/search-pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          startPage: Number(byId("jlc-start-page").value),
          endPage: Number(byId("jlc-end-page").value),
          pageSize: Number(byId("jlc-page-size").value),
        }),
      })
    );
    if (requestId !== state.jlc.facetRequestId) return;
    state.jlc.currentPage = Number(result.startPage ?? byId("jlc-start-page").value);
    state.jlc.pageSize = Number(result.pageSize ?? byId("jlc-page-size").value);
    state.jlc.total = result.total;
    state.jlc.pageProducts =
      result.pages?.find((item) => item.page === state.jlc.currentPage)?.products ??
      result.pages?.[0]?.products ??
      [];
    const added = mergeProducts(result.products);
    setWorkspace("jlc");
    setStatus(
      `JLCPCB returned ${result.products.length} components from ${result.pagesFetched} pages; ${added} new components added to the catalog${result.total == null ? "." : ` (${formatNumber(result.total)} total results).`}`
    );
    if (scrollToCatalog) byId("catalog-title").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (requestId === state.jlc.facetRequestId) setStatus(error.message, true);
  } finally {
    if (requestId === state.jlc.facetRequestId) {
      state.jlc.searching = false;
      updateJlcSearchControls();
      renderCatalogPagination();
    }
  }
}

async function loadJlcPage(page) {
  if (!Number.isInteger(page) || page < 1 || state.jlc.searching) return;
  clearTimeout(state.jlc.searchTimer);
  const requestId = ++state.jlc.facetRequestId;
  state.jlc.searching = true;
  updateJlcSearchControls();
  renderCatalogPagination();
  setStatus(`Loading JLCPCB page ${formatNumber(page)}…`);
  try {
    const query = buildJlcQuery();
    const result = await readApiResponse(
      await fetch("/api/jlc/search-pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          startPage: page,
          endPage: page,
          pageSize: state.jlc.pageSize,
        }),
      })
    );
    if (requestId !== state.jlc.facetRequestId) return;
    state.jlc.currentPage = page;
    state.jlc.pageSize = Number(result.pageSize ?? state.jlc.pageSize);
    state.jlc.total = result.total ?? state.jlc.total;
    state.jlc.pageProducts = result.pages?.[0]?.products ?? result.products;
    byId("jlc-start-page").value = String(page);
    byId("jlc-end-page").value = String(page);
    const added = mergeProducts(state.jlc.pageProducts);
    setStatus(
      `Page ${formatNumber(page)} loaded: ${state.jlc.pageProducts.length} components; ${added} new components added to the catalog.`
    );
  } catch (error) {
    if (requestId === state.jlc.facetRequestId) setStatus(error.message, true);
  } finally {
    if (requestId === state.jlc.facetRequestId) {
      state.jlc.searching = false;
      updateJlcSearchControls();
      renderCatalogPagination();
    }
  }
}

byId("manual-tab").addEventListener("click", () => setWorkspace("manual"));
byId("jlc-tab").addEventListener("click", () => setWorkspace("jlc"));
byId("jlc-tab").parentElement.addEventListener("keydown", (event) => {
  const tabs = [byId("jlc-tab"), byId("manual-tab")];
  const currentIndex = tabs.indexOf(document.activeElement);
  if (currentIndex < 0) return;
  const nextIndex =
    event.key === "ArrowRight" ? (currentIndex + 1) % tabs.length
      : event.key === "ArrowLeft" ? (currentIndex - 1 + tabs.length) % tabs.length
        : event.key === "Home" ? 0
          : event.key === "End" ? tabs.length - 1
            : -1;
  if (nextIndex < 0) return;
  event.preventDefault();
  tabs[nextIndex].focus();
  tabs[nextIndex].click();
});

byId("jlc-category").addEventListener("change", (event) => {
  if (byId("jlc-facet-dialog").open) byId("jlc-facet-dialog").close();
  clearTimeout(state.jlc.searchTimer);
  state.jlc.facetRequestId += 1;
  state.jlc.facetsLoading = false;
  state.jlc.searching = false;
  state.jlc.categoryId = event.currentTarget.value;
  state.jlc.subcategoryId = "";
  state.jlc.facets = null;
  state.jlc.selections = {};
  state.jlc.ranges = {};
  state.jlc.rangeAnchors = {};
  const category = state.jlc.categories.find(
    (item) => String(item.id) === state.jlc.categoryId
  );
  const subcategorySelect = byId("jlc-subcategory");
  subcategorySelect.replaceChildren(new Option(
    category?.children.length ? "All subcategories" : "This category has no subcategories",
    ""
  ));
  for (const child of category?.children ?? []) {
    subcategorySelect.add(new Option(
      `${child.name} (${formatNumber(child.count)})`,
      String(child.id)
    ));
  }
  subcategorySelect.disabled = !category || category.children.length === 0;
  renderJlcFacetControls();
  updateJlcSearchControls();
  if (category) void runJlcSearch();
});

byId("jlc-subcategory").addEventListener("change", (event) => {
  if (byId("jlc-facet-dialog").open) byId("jlc-facet-dialog").close();
  clearTimeout(state.jlc.searchTimer);
  state.jlc.facetRequestId += 1;
  state.jlc.facetsLoading = false;
  state.jlc.searching = false;
  state.jlc.subcategoryId = event.currentTarget.value;
  state.jlc.facets = null;
  state.jlc.selections = {};
  state.jlc.ranges = {};
  state.jlc.rangeAnchors = {};
  renderJlcFacetControls();
  void runJlcSearch();
});

byId("jlc-query").addEventListener("input", updateJlcSearchControls);
byId("jlc-keyword").addEventListener("input", scheduleJlcSearch);
for (const id of ["jlc-library-basic", "jlc-library-extended", "jlc-sort", "jlc-availability", "jlc-pcba-type"]) {
  byId(id).addEventListener("change", () => {
    updateJlcFacetSummary();
    scheduleJlcSearch();
  });
}
for (const id of ["jlc-start-page", "jlc-end-page", "jlc-page-size"]) {
  byId(id).addEventListener("change", scheduleJlcSearch);
}
byId("load-jlc-facets").addEventListener("click", loadJlcFacets);

byId("run-jlc-search").addEventListener("click", () => void runJlcSearch(true));
byId("clear-jlc-filters").addEventListener("click", () => {
  state.jlc.selections = {};
  state.jlc.ranges = {};
  state.jlc.rangeAnchors = {};
  byId("jlc-library-basic").checked = false;
  byId("jlc-library-extended").checked = false;
  byId("jlc-availability").value = "";
  byId("jlc-pcba-type").value = "";
  byId("jlc-start-page").value = "1";
  byId("jlc-end-page").value = "1";
  renderJlcFacetControls();
  updateJlcFacetSummary();
  void runJlcSearch();
});

void loadJlcCategories();

byId("upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = byId("json-file").files?.[0];
  const pastedJson = byId("json-paste").value.trim();
  if (!file && !pastedJson) {
    setStatus("Choose a JSON file or paste its contents.", true);
    return;
  }

  const button = event.submitter;
  button.disabled = true;
  setStatus(file && !pastedJson ? `Reading ${file.name}…` : "Processing pasted JSON…");
  try {
    const jsonText = pastedJson || await file.text();
    const result = await readApiResponse(
      await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonText }),
      })
    );
    const added = mergeProducts(result.products);
    setStatus(`Imported ${result.products.length} components; ${added} new components added to the catalog.`);
    byId("json-paste").value = "";
    byId("json-file").value = "";
    byId("file-label").textContent = "Choose or drop a file";
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

byId("json-file").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  byId("file-label").textContent = file ? file.name : "Choose or drop a file";
});

const dropzone = byId("dropzone");
for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-over");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-over");
  });
}
dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".json")) {
    setStatus("Choose a file with the .json extension.", true);
    return;
  }
  const transfer = new DataTransfer();
  transfer.items.add(file);
  byId("json-file").files = transfer.files;
  byId("file-label").textContent = file.name;
});

byId("url-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  byId("url-file-label").textContent = `Loading ${file.name}…`;
  try {
    byId("product-urls").value = await file.text();
    byId("url-file-label").textContent = `${file.name} loaded. You can review or edit the list before fetching.`;
  } catch (error) {
    byId("url-file-label").textContent = "Could not read the file.";
    setStatus(`Could not read ${file.name}: ${error.message}`, true);
  }
});

function extractProductInputs(text) {
  const matches = text.match(/https?:\/\/[^\s"'<>;,]+|\bC\d{4,}\b/gi) ?? [];
  const normalized = matches
    .map((input) => input.replace(/[).}\]]+$/, ""))
    .filter(Boolean);
  return [...new Set(normalized)];
}

byId("url-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const inputs = extractProductInputs(byId("product-urls").value);
  const button = event.submitter;
  if (!inputs.length) {
    setStatus("Paste at least one URL or component code, or load a file.", true);
    return;
  }

  button.disabled = true;
  const products = [];
  const errors = [];
  try {
    for (const [index, input] of inputs.entries()) {
      setStatus(`Fetching component ${index + 1} of ${inputs.length}…`);
      try {
        const result = await readApiResponse(
          await fetch("/api/product-url", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: input }),
          })
        );
        products.push(result.product);
      } catch (error) {
        errors.push(`${input}: ${error.message}`);
      }
    }
    const added = mergeProducts(products);
    const summary = `${products.length} fetched successfully; ${added} new components added.`;
    const errorSummary = errors.length
      ? ` Failed: ${errors.length}. ${errors.slice(0, 3).join(" · ")}${errors.length > 3 ? "…" : ""}`
      : "";
    setStatus(summary + errorSummary, errors.length > 0 && products.length === 0);
  } finally {
    button.disabled = false;
  }
});

byId("search-input").addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});
byId("sort-select").addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});
byId("clear-filters").addEventListener("click", () => {
  state.filters = {
    brand: [],
    priceMin: "",
    priceMax: "",
    priceValues: [],
    stockMin: "",
    stockMax: "",
    stockValues: [],
    attributeRanges: {},
    attributeValues: {},
  };
  renderFilterControls();
  render();
});

byId("open-filters").addEventListener("click", () => {
  showModal(byId("filters-dialog"));
});
byId("close-filters").addEventListener("click", () => {
  byId("filters-dialog").close();
});
byId("filters-dialog").addEventListener("click", (event) => {
  if (event.target === byId("filters-dialog")) byId("filters-dialog").close();
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    byId("search-input").focus();
  }
});

byId("download-button").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.products, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "components-export.json";
  link.click();
  URL.revokeObjectURL(url);
});

byId("clear-button").addEventListener("click", () => {
  state.products = [];
  state.selected.clear();
  state.jlc.pageProducts = null;
  state.jlc.total = null;
  state.jlc.currentPage = 1;
  state.filters = {
    brand: [],
    priceMin: "",
    priceMax: "",
    priceValues: [],
    stockMin: "",
    stockMax: "",
    stockValues: [],
    attributeRanges: {},
    attributeValues: {},
  };
  renderFilterControls();
  if (byId("compare-section").open) byId("compare-section").close();
  setStatus("Catalog cleared.");
  render();
});

function renderComparison() {
  const products = state.products.filter((product) => state.selected.has(productKey(product)));
  if (products.length < 2) return;

  const attributeNames = [...new Set(products.flatMap((product) => [...getAttributeMap(product).keys()]))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const fields = [
    ["Brand", (product) => product.componentBrandEn],
    ["Code", (product) => product.componentCode],
    ["Model", (product) => product.componentModelEn],
    ["Package", (product) => product.componentSpecificationEn],
    ["Stock", (product) => product.stockCount == null ? null : formatNumber(product.stockCount)],
    ["Unit price", (product) => formatMoney(product.initialPrice)],
    ["Source", (product) => product.componentSource],
    ["Description", (product) => product.describe],
    ["URL", (product) => product.productUrl],
  ];
  const table = element("table", "compare-table");
  const thead = document.createElement("thead");
  const header = document.createElement("tr");
  header.append(element("th", "", "Field"));
  for (const product of products) {
    header.append(element("th", "compare-product", product.componentName || product.componentCode));
  }
  thead.append(header);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const [label, getter] of fields) {
    const row = document.createElement("tr");
    row.append(element("td", "", label));
    for (const product of products) {
      const cell = document.createElement("td");
      const value = getter(product);
      if (label === "URL" && value) {
        const link = element("a", "product-link", value);
        link.href = value;
        link.target = "_blank";
        link.rel = "noreferrer";
        cell.append(link);
      } else {
        cell.textContent = value == null || value === "" ? "—" : String(value);
      }
      row.append(cell);
    }
    tbody.append(row);
  }

  for (const attributeName of attributeNames) {
    const row = document.createElement("tr");
    row.append(element("td", "", attributeName));
    for (const product of products) {
      row.append(element("td", "", getAttributeMap(product).get(attributeName) || "—"));
    }
    tbody.append(row);
  }

  for (const priceField of [
    ["Price by quantity", "componentPrices"],
    ["Purchase price", "buyComponentPrices"],
  ]) {
    const [label, key] = priceField;
    const row = document.createElement("tr");
    row.append(element("td", "", label));
    for (const product of products) {
      const cell = document.createElement("td");
      const list = element("div", "compare-price-list");
      for (const tier of product[key] ?? []) {
        const end = tier.endNumber == null || Number(tier.endNumber) < 0
          ? "+"
          : `–${formatNumber(tier.endNumber)}`;
        list.append(element("span", "compare-price-tier",
          `${formatNumber(tier.startNumber)}${end} units · ${formatMoney(tier.productPrice)}`));
      }
      if (!list.childElementCount) list.append(element("span", "compare-price-tier", "—"));
      cell.append(list);
      row.append(cell);
    }
    tbody.append(row);
  }
  table.append(tbody);
  byId("compare-content").replaceChildren(table);
}

byId("compare-button").addEventListener("click", () => {
  renderComparison();
  if (!byId("compare-section").open) showModal(byId("compare-section"));
});
byId("close-compare").addEventListener("click", () => {
  byId("compare-section").close();
});
byId("compare-section").addEventListener("click", (event) => {
  if (event.target === byId("compare-section")) byId("compare-section").close();
});
byId("close-jlc-facet-dialog").addEventListener("click", () => {
  byId("jlc-facet-dialog").close();
});
byId("jlc-facet-dialog").addEventListener("click", (event) => {
  if (event.target === byId("jlc-facet-dialog")) byId("jlc-facet-dialog").close();
});

setWorkspace("jlc");
render();
