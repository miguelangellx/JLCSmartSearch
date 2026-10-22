const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const HOST = process.env.HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY_SIZE = 30 * 1024 * 1024;
const DIST_DIR = path.join(__dirname, "dist");
const DETAIL_URL =
  "https://jlcpcb.com/api/overseas-core-platform/shoppingCart/smtGood/getComponentDetail";
const COMPONENT_SEARCH_URL =
  "https://jlcpcb.com/api/overseas-pcb-order/v1/shoppingCart/smtGood/selectSmtComponentList/v2";
const COMPONENT_FACET_URL =
  "https://jlcpcb.com/api/overseas-pcb-order/v1/componentSearch/filterComponentAttribute";
const COMPONENT_CATEGORY_PAYLOAD = { searchType: 5, pageSize: 0 };
const MAX_JLC_PAGES = 100;
const MAX_JLC_PAGE_SIZE = 100;
const STATIC_CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizePrices(prices) {
  if (!Array.isArray(prices)) return [];

  return prices.map((price) => ({
    startNumber: price.startNumber ?? null,
    endNumber: price.endNumber ?? null,
    productPrice: price.productPrice ?? null,
  }));
}

function normalizeHttpsUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeImageUrl(component) {
  const candidates = [
    ...(Array.isArray(component.imageList)
      ? component.imageList.flatMap((image) => [
        image?.productBigImageAccessIdUrl,
        image?.productImageAccessIdUrl,
        image?.productBigImage,
        image?.productImage,
      ])
      : []),
    component.componentImageUrl,
    component.productBigImageAccessIdUrl,
    component.minImageAccessIdUrl,
    component.minImage,
    component.imageUrl,
  ];

  for (const candidate of candidates) {
    const value = normalizeHttpsUrl(candidate);
    if (!value) continue;
    try {
      const hostname = new URL(value).hostname.toLowerCase();
      if (
        hostname === "lcsc.com" ||
        hostname.endsWith(".lcsc.com") ||
        hostname === "jlcpcb.com" ||
        hostname.endsWith(".jlcpcb.com") ||
        hostname.endsWith(".aliyuncs.com")
      ) {
        return value;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function makeProductUrl(component) {
  const existingUrl = normalizeHttpsUrl(component.productUrl);
  if (existingUrl) return existingUrl;

  const lcscUrl = normalizeHttpsUrl(component.lcscGoodsUrl);
  if (lcscUrl) return lcscUrl;

  const suffix = component.urlSuffix;
  if (typeof suffix === "string" && suffix.length > 0) {
    const safeSuffix = suffix
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `https://jlcpcb.com/partdetail/${safeSuffix}`;
  }

  const code = component.componentCode;
  return code ? `https://jlcpcb.com/partdetail/${encodeURIComponent(code)}` : null;
}

function normalizeProduct(component) {
  if (!component || typeof component !== "object" || Array.isArray(component)) {
    throw new Error("Each product must be a JSON object.");
  }

  const attributes = Array.isArray(component.attributes)
    ? component.attributes
      .filter((attribute) => attribute && typeof attribute === "object")
      .map((attribute) => ({
        attribute_name_en:
          attribute.attribute_name_en ??
          attribute.attributeNameEn ??
          attribute.name ??
          null,
        attribute_value_name:
          attribute.attribute_value_name ??
          attribute.attributeValueName ??
          attribute.value ??
          null,
      }))
    : [];

  return {
    componentName: firstValue(
      component.componentName,
      component.componentNameEn,
      component.erpComponentName,
      component.componentModelEn,
      component.componentCode,
      "Unnamed component"
    ),
    stockCount: component.stockCount ?? component.overseasStockCount ?? null,
    componentPrices: normalizePrices(
      firstValue(component.componentPrices, component.prices, component.jlcPrices)
    ),
    buyComponentPrices: normalizePrices(
      firstValue(component.buyComponentPrices, component.buyPrices)
    ),
    initialPrice:
      component.initialPrice ??
      component.leastNumberPrice ??
      component.shopCostPrice ??
      null,
    attributes,
    imageUrl: normalizeImageUrl(component),
    describe: component.describe ?? null,
    urlSuffix: component.urlSuffix ?? null,
    productUrl: makeProductUrl(component),
    lcscGoodsUrl: component.lcscGoodsUrl ?? null,
    dataManualUrl: normalizeHttpsUrl(component.dataManualUrl),
    dataManualOfficialLink: normalizeHttpsUrl(component.dataManualOfficialLink),
    componentCode: component.componentCode ?? null,
    componentModelEn: component.componentModelEn ?? null,
    componentBrandEn: component.componentBrandEn ?? null,
    componentSource: component.componentSource ?? null,
    componentLibraryType: component.componentLibraryType ?? null,
    componentSpecificationEn: component.componentSpecificationEn ?? null,
  };
}

function unwrapProducts(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  if (value.componentCode) return [value];

  for (const key of ["data", "list", "componentList", "componentPageInfo"]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested;
    if (nested && typeof nested === "object") {
      const products = unwrapProducts(nested);
      if (products) return products;
    }
  }
  return null;
}

function findComponentList(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === "object" && item.componentCode != null)) {
      return value;
    }
    for (const item of value) {
      const found = findComponentList(item);
      if (found) return found;
    }
    return null;
  }
  for (const child of Object.values(value)) {
    const found = findComponentList(child);
    if (found) return found;
  }
  return null;
}

function parseJlcQuery(value) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      const error = new Error("The request body is not valid JSON.");
      error.statusCode = 400;
      throw error;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("Paste the JSON object from the JLCPCB request body.");
    error.statusCode = 400;
    throw error;
  }
  return value;
}

async function postJlcJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      origin: "https://jlcpcb.com",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`JLCPCB returned HTTP ${response.status}.`);
  }
  const result = await response.json();
  if (result.success === false || (result.code != null && Number(result.code) !== 200)) {
    throw new Error(`JLCPCB error: ${result.message ?? result.code ?? "invalid response"}`);
  }
  return result.data ?? result;
}

function makeFacetPayload(query) {
  const baseQueryDto = query.baseQueryDto ?? {
    componentBrandList: query.componentBrandList ?? [],
    componentSpecificationList: query.componentSpecificationList ?? [],
    componentTypeIdList: query.secondSortId == null ? [] : [query.secondSortId],
    orderLibraryTypeList: [],
    packageTypeList: [],
    filterType: null,
    productTypeIdList: query.firstSortId == null ? [] : [query.firstSortId],
    keyword: query.keyword ?? null,
    queryShelveStatus: null,
  };
  return {
    baseQueryDto,
    catalogLevel: query.catalogLevel ?? 2,
    nowCondition: query.nowCondition ?? "",
    paramList: query.paramList ?? [],
    queryString: query.queryString ?? null,
  };
}

async function getJlcFacets(query) {
  const selections = [];
  if (query.componentBrandList?.length) selections.push("brand");
  if (query.componentSpecificationList?.length) selections.push("package");

  const attributeNames = new Set();
  for (const item of query.componentAttributeList ?? []) {
    if (item && typeof item === "object") {
      for (const [name, values] of Object.entries(item)) {
        if (Array.isArray(values) && values.length) attributeNames.add(name);
      }
    }
  }
  for (const item of query.paramList ?? []) {
    if (item?.paramName && Array.isArray(item.paramValueList) && item.paramValueList.length) {
      attributeNames.add(item.paramName);
    }
  }
  selections.push(...[...attributeNames].map((name) => `attribute:${name}`));

  const responses = await Promise.all([
    postJlcJson(COMPONENT_FACET_URL, makeFacetPayload(query)),
    ...selections.map((selection) => {
      const unfilteredQuery = structuredClone(query);
      if (selection === "brand") {
        unfilteredQuery.componentBrandList = [];
        if (unfilteredQuery.baseQueryDto) unfilteredQuery.baseQueryDto.componentBrandList = [];
      } else if (selection === "package") {
        unfilteredQuery.componentSpecificationList = [];
        if (unfilteredQuery.baseQueryDto) {
          unfilteredQuery.baseQueryDto.componentSpecificationList = [];
        }
      } else {
        const name = selection.slice("attribute:".length);
        unfilteredQuery.componentAttributeList = (unfilteredQuery.componentAttributeList ?? [])
          .filter((item) => !item || !Object.hasOwn(item, name));
        unfilteredQuery.paramList = (unfilteredQuery.paramList ?? [])
          .filter((item) => item?.paramName !== name);
      }
      return postJlcJson(COMPONENT_FACET_URL, makeFacetPayload(unfilteredQuery));
    }),
  ]);
  const [facets, ...unfilteredFacets] = responses;
  if (!Array.isArray(facets.paramRangeList)) {
    throw new Error("The JLCPCB response does not contain attribute facets.");
  }

  selections.forEach((selection, index) => {
    const alternative = unfilteredFacets[index];
    if (selection === "brand") {
      facets.componentBrandList = alternative.componentBrandList ?? facets.componentBrandList;
    } else if (selection === "package") {
      facets.componentSpecificationList =
        alternative.componentSpecificationList ?? facets.componentSpecificationList;
    } else {
      const name = selection.slice("attribute:".length);
      const alternativeFacet = alternative.paramRangeList?.find((facet) => facet.key === name);
      const currentFacet = facets.paramRangeList.find((facet) => facet.key === name);
      if (alternativeFacet && currentFacet) currentFacet.subAggs = alternativeFacet.subAggs;
    }
  });
  return facets;
}

function componentListFromPage(data) {
  const pageInfo = data.componentPageInfo ?? data;
  const list = pageInfo.list ?? pageInfo.componentList ?? findComponentList(pageInfo);
  if (!Array.isArray(list)) return null;
  return { list, total: Number(pageInfo.total ?? data.total) };
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) {
      const error = new Error("The request exceeds the 30 MB limit.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("The request body is not valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function extractComponentCode(input) {
  const raw = input.trim();
  if (/^C\d{4,}$/i.test(raw)) return raw.toUpperCase();

  let url;
  try {
    url = new URL(raw);
  } catch {
    const error = new Error("Enter a valid JLCPCB/LCSC URL or a code such as C123456.");
    error.statusCode = 400;
    throw error;
  }

  const hostAllowed =
    url.hostname === "jlcpcb.com" ||
    url.hostname.endsWith(".jlcpcb.com") ||
    url.hostname === "lcsc.com" ||
    url.hostname.endsWith(".lcsc.com");
  if (url.protocol !== "https:" || !hostAllowed) {
    const error = new Error("Only HTTPS URLs from jlcpcb.com or lcsc.com are accepted.");
    error.statusCode = 400;
    throw error;
  }

  const candidates = [
    url.searchParams.get("componentCode"),
    url.searchParams.get("component_code"),
    url.pathname,
  ];
  for (const candidate of candidates) {
    const match = candidate?.match(/C\d{4,}/i);
    if (match) return match[0].toUpperCase();
  }

  const error = new Error("Could not find the component's C... code in that URL.");
  error.statusCode = 400;
  throw error;
}

async function getProductFromUrl(input) {
  const componentCode = extractComponentCode(input);
  const url = new URL(DETAIL_URL);
  url.searchParams.set("componentCode", componentCode);

  const upstream = await fetch(url, {
    headers: { accept: "application/json, text/plain, */*" },
    signal: AbortSignal.timeout(20_000),
  });

  if (!upstream.ok) {
    throw new Error(`JLCPCB returned HTTP ${upstream.status} for ${componentCode}.`);
  }

  const result = await upstream.json();
  if (
    result.success === false ||
    (result.code != null && Number(result.code) !== 200)
  ) {
    throw new Error(
      `JLCPCB did not return product ${componentCode}: ${result.message ?? result.code ?? "invalid response"
      }`
    );
  }

  const product = result.data;
  if (!product || typeof product !== "object" || !product.componentCode) {
    throw new Error(`Component ${componentCode} was not found.`);
  }

  return normalizeProduct(product);
}

async function serveStatic(pathname, request, response) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const relativePath = decodedPath.replace(/^[/\\]+/, "") || "index.html";
  const filePath = path.resolve(DIST_DIR, relativePath);
  if (filePath !== DIST_DIR && !filePath.startsWith(`${DIST_DIR}${path.sep}`)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  let contents;
  try {
    contents = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    throw error;
  }
  const contentType =
    STATIC_CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ??
    "application/octet-stream";
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": contents.length,
    "cache-control": decodedPath.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : decodedPath === "/favicon.svg"
        ? "public, max-age=3600"
        : "no-cache",
    "x-content-type-options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : contents);
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);

  try {
    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/import") {
      const body = await readJsonBody(request);
      if (typeof body.jsonText !== "string") {
        sendJson(response, 400, { error: "JSON content is required." });
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(body.jsonText);
      } catch {
        sendJson(response, 400, { error: "The content is not valid JSON." });
        return;
      }

      const products = unwrapProducts(parsed);
      if (!products) {
        sendJson(response, 400, {
          error: "No products found. The JSON must be an array or a response containing data/list.",
        });
        return;
      }

      sendJson(response, 200, { products: products.map(normalizeProduct) });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/product-url") {
      const body = await readJsonBody(request);
      if (typeof body.url !== "string" || body.url.trim() === "") {
        sendJson(response, 400, { error: "Enter a product URL." });
        return;
      }

      const product = await getProductFromUrl(body.url);
      sendJson(response, 200, { product });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/jlc/facets") {
      const body = await readJsonBody(request);
      const query = parseJlcQuery(body.query);
      const facets = await getJlcFacets(query);
      sendJson(response, 200, {
        total: facets.total ?? null,
        componentBrandList: facets.componentBrandList ?? [],
        componentSpecificationList: facets.componentSpecificationList ?? [],
        paramRangeList: facets.paramRangeList,
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/jlc/categories") {
      const data = await postJlcJson(COMPONENT_SEARCH_URL, COMPONENT_CATEGORY_PAYLOAD);
      if (!Array.isArray(data.sortAndCountVoList)) {
        throw new Error("The JLCPCB response does not contain the category list.");
      }
      const normalizeCategory = (category) => ({
        id: category.componentSortKeyId,
        name: category.sortName,
        count: Number(category.componentCount ?? 0),
        children: Array.isArray(category.childSortList)
          ? category.childSortList.map(normalizeCategory)
          : [],
      });
      sendJson(response, 200, {
        categories: data.sortAndCountVoList.map(normalizeCategory),
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/jlc/search-pages") {
      const body = await readJsonBody(request);
      const query = parseJlcQuery(body.query);
      const startPage = Number(body.startPage);
      const endPage = Number(body.endPage);
      const pageSize = Number(body.pageSize ?? query.pageSize ?? 25);
      if (
        !Number.isInteger(startPage) ||
        !Number.isInteger(endPage) ||
        startPage < 1 ||
        endPage < startPage ||
        endPage - startPage + 1 > MAX_JLC_PAGES
      ) {
        const error = new Error(`Enter a valid page range (up to ${MAX_JLC_PAGES} pages per request).`);
        error.statusCode = 400;
        throw error;
      }
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_JLC_PAGE_SIZE) {
        const error = new Error(`Page size must be between 1 and ${MAX_JLC_PAGE_SIZE}.`);
        error.statusCode = 400;
        throw error;
      }

      const products = [];
      const pages = [];
      let total = null;
      let pagesFetched = 0;
      for (let currentPage = startPage; currentPage <= endPage; currentPage += 1) {
        const data = await postJlcJson(COMPONENT_SEARCH_URL, {
          ...query,
          currentPage,
          pageSize,
        });
        const page = componentListFromPage(data);
        if (!page) throw new Error(`Could not find the component list on page ${currentPage}.`);
        if (Number.isFinite(page.total)) total = page.total;
        const normalized = page.list.map(normalizeProduct);
        pages.push({ page: currentPage, products: normalized });
        products.push(...normalized);
        pagesFetched += 1;
        if (page.list.length === 0 || (total != null && currentPage * pageSize >= total)) break;
      }
      sendJson(response, 200, { products, pages, total, pagesFetched, pageSize, startPage, endPage });
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(requestUrl.pathname, request, response);
      return;
    }

    sendJson(response, 404, { error: "Route not found." });
  } catch (error) {
    console.error("Error processing request:", error);

    if (response.destroyed || response.writableEnded) {
      return;
    }

    const statusCode = Number.isInteger(error.statusCode)
      ? error.statusCode
      : 500;

    sendJson(response, statusCode, {
      error:
        statusCode >= 500
          ? "Internal server error."
          : error.message ?? "Request error.",
    });
  }
});

server.listen(PORT, HOST, () => {
  const displayHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`JLCSmartSearch available at http://${displayHost}:${PORT}`);
});
