(function () {
  "use strict";

  const config = window.LATTE_LAB_CONFIG || {};
  const telegram = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const currencyFormatters = {
    USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
    KHR: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
  };

  const els = {
    brandName: document.getElementById("brandName"),
    searchInput: document.getElementById("searchInput"),
    promoOnly: document.getElementById("promoOnly"),
    categoryTabs: document.getElementById("categoryTabs"),
    menuGrid: document.getElementById("menuGrid"),
    dataStatus: document.getElementById("dataStatus"),
    cartToggle: document.getElementById("cartToggle"),
    cartClose: document.getElementById("cartClose"),
    cartDrawer: document.getElementById("cartDrawer"),
    drawerBackdrop: document.getElementById("drawerBackdrop"),
    cartCount: document.getElementById("cartCount"),
    cartItems: document.getElementById("cartItems"),
    checkoutForm: document.getElementById("checkoutForm"),
    customerName: document.getElementById("customerName"),
    addressField: document.getElementById("addressField"),
    summaryItems: document.getElementById("summaryItems"),
    summaryTotal: document.getElementById("summaryTotal"),
    submitOrder: document.getElementById("submitOrder"),
    submitNote: document.getElementById("submitNote"),
    mobileCartBar: document.getElementById("mobileCartBar"),
    mobileCartLabel: document.getElementById("mobileCartLabel"),
    mobileCartTotal: document.getElementById("mobileCartTotal"),
    toast: document.getElementById("toast"),
    // Tabs
    tabMenu: document.getElementById("tabMenu"),
    tabOrders: document.getElementById("tabOrders"),
    menuSection: document.getElementById("menuSection"),
    ordersSection: document.getElementById("ordersSection"),
    ordersList: document.getElementById("ordersList"),
    ordersStatus: document.getElementById("ordersStatus"),
    historyBadge: document.getElementById("historyBadge"),
    // Image lightbox
    imageLightbox: document.getElementById("imageLightbox"),
    lightboxImage: document.getElementById("lightboxImage"),
    lightboxName: document.getElementById("lightboxName"),
    lightboxPrice: document.getElementById("lightboxPrice"),
  };

  const state = {
    products: [],
    categories: ["All"],
    activeCategory: "All",
    query: "",
    promoOnly: false,
    currency: config.defaultCurrency || "USD",
    imageFiles: [],
    cart: new Map(),
    submitting: false,
    activeTab: "menu",
    myOrders: [],
    loadingOrders: false,
    expandedOrders: new Set(),
  };

  let toastTimer = null;
  let supabaseClient = null;
  let realtimeChannel = null;
  let pollInterval = null;

  init();

  async function init() {
    applyConfig();
    initTelegram();
    initSupabase();
    bindEvents();
    refreshIcons();

    try {
      state.imageFiles = await loadImageManifest();
      state.products = await loadMenuFromExcel();
      state.categories = ["All", ...unique(state.products.map((product) => product.type))];
      els.dataStatus.textContent = `${state.products.length} drinks loaded from Excel.`;
      render();
    } catch (error) {
      console.error(error);
      els.dataStatus.textContent = "Could not load menu and price.xlsx. Check the file path and hosting.";
      showToast("Menu failed to load");
    }
  }

  async function loadImageManifest() {
    try {
      const response = await fetch(config.imageManifest || "image/manifest.json", { cache: "no-store" });
      if (!response.ok) return [];
      const files = await response.json();
      return Array.isArray(files) ? files.filter(Boolean) : [];
    } catch (error) {
      console.warn("Image manifest unavailable", error);
      return [];
    }
  }

  function applyConfig() {
    if (config.brandName) {
      els.brandName.textContent = config.brandName;
      document.title = `${config.brandName} Order`;
    }
  }

  function initTelegram() {
    if (!telegram) return;

    telegram.ready();
    telegram.expand();

    const theme = telegram.themeParams || {};
    if (theme.bg_color) document.documentElement.style.setProperty("--bg", theme.bg_color);
    if (theme.text_color) document.documentElement.style.setProperty("--ink", theme.text_color);
    if (theme.button_color) document.documentElement.style.setProperty("--brand", theme.button_color);
    if (theme.hint_color) document.documentElement.style.setProperty("--muted", theme.hint_color);

    const user = telegram.initDataUnsafe && telegram.initDataUnsafe.user;
    if (user && !els.customerName.value) {
      els.customerName.value = [user.first_name, user.last_name].filter(Boolean).join(" ");
    }
  }

  function initSupabase() {
    const hasConfig =
      config.supabaseUrl &&
      config.supabaseAnonKey &&
      !config.supabaseUrl.includes("YOUR_") &&
      !config.supabaseAnonKey.includes("YOUR_");

    if (!hasConfig || !window.supabase) {
      els.submitNote.textContent =
        "Supabase is not configured yet. In Telegram, orders will be sent to the bot with WebApp.sendData.";
      return;
    }

    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    els.submitNote.textContent = "Orders will be saved to Supabase.";
  }

  function bindEvents() {
    els.searchInput.addEventListener("input", (event) => {
      state.query = event.target.value.trim().toLowerCase();
      renderProducts();
    });

    els.promoOnly.addEventListener("change", (event) => {
      state.promoOnly = event.target.checked;
      renderProducts();
    });

    document.querySelectorAll("[data-currency]").forEach((button) => {
      button.addEventListener("click", () => {
        state.currency = button.dataset.currency;
        document.querySelectorAll("[data-currency]").forEach((item) => {
          item.classList.toggle("is-active", item.dataset.currency === state.currency);
        });
        renderProducts();
        renderCart();
      });
    });

    els.categoryTabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.activeCategory = button.dataset.category;
      renderCategories();
      renderProducts();
    });

    els.menuGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      updateQuantity(button.dataset.id, button.dataset.action);
    });

    els.cartItems.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      updateQuantity(button.dataset.id, button.dataset.action);
    });

    els.cartToggle.addEventListener("click", openCart);
    els.mobileCartBar.addEventListener("click", openCart);
    els.cartClose.addEventListener("click", closeCart);
    els.drawerBackdrop.addEventListener("click", closeCart);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeCart();
    });

    els.checkoutForm.addEventListener("change", updateAddressLabel);
    els.checkoutForm.addEventListener("submit", submitOrder);

    // Tab navigation
    els.tabMenu.addEventListener("click", () => switchTab("menu"));
    els.tabOrders.addEventListener("click", () => switchTab("orders"));

    // Image lightbox
    els.lightboxImage.addEventListener("click", closeLightbox);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeLightbox();
    });
  }

  // ============================================================
  // Tab Navigation
  // ============================================================

  function switchTab(tab) {
    state.activeTab = tab;
    els.tabMenu.classList.toggle("is-active", tab === "menu");
    els.tabOrders.classList.toggle("is-active", tab === "orders");
    els.menuSection.hidden = tab !== "menu";
    els.ordersSection.hidden = tab !== "orders";

    if (tab === "orders") {
      state.expandedOrders.clear();
      loadMyOrders();
      startPolling();
    } else {
      unsubscribeRealtime();
      stopPolling();
    }
  }

  // ============================================================
  // Order History
  // ============================================================

  async function loadMyOrders() {
    if (!supabaseClient || state.loadingOrders) return;

    const telegramUser = getTelegramUser();
    const userId = telegramUser ? String(telegramUser.id) : null;
    if (!userId) {
      els.ordersStatus.textContent = "Unable to identify Telegram user.";
      return;
    }

    state.loadingOrders = true;
    els.ordersStatus.textContent = "Loading your orders...";

    try {
      const { data, error } = await supabaseClient
        .from("orders")
        .select("*")
        .eq("telegram_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      state.myOrders = data || [];
      renderOrders();

      // Subscribe to realtime updates for this user's orders
      subscribeToOrderUpdates(userId);
    } catch (error) {
      console.error("Failed to load orders:", error);
      els.ordersStatus.textContent = "Failed to load orders.";
    } finally {
      state.loadingOrders = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollInterval = setInterval(refreshOrdersSilently, 10000); // every 10 seconds
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  async function refreshOrdersSilently() {
    if (!supabaseClient || state.activeTab !== "orders") return;

    const telegramUser = getTelegramUser();
    const userId = telegramUser ? String(telegramUser.id) : null;
    if (!userId) return;

    try {
      const { data, error } = await supabaseClient
        .from("orders")
        .select("*")
        .eq("telegram_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) return;
      if (!data) return;

      const changed = JSON.stringify(data) !== JSON.stringify(state.myOrders);
      if (changed) {
        state.myOrders = data;
        renderOrders();
      }
    } catch (_) {
      // silent polling failure
    }
  }

  function subscribeToOrderUpdates(userId) {
    unsubscribeRealtime();

    if (!supabaseClient || !supabaseClient.realtime) return;

    try {
      realtimeChannel = supabaseClient
        .channel("orders-updates")
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "orders",
            filter: `telegram_user_id=eq.${userId}`,
          },
          (payload) => {
            const updated = payload.new;
            const index = state.myOrders.findIndex((o) => o.id === updated.id);
            if (index >= 0) {
              state.myOrders[index] = updated;
              renderOrders();
            }
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            console.log("Realtime: listening for order updates");
          }
        });
    } catch (error) {
      console.warn("Realtime subscription failed:", error);
    }
  }

  function unsubscribeRealtime() {
    if (realtimeChannel) {
      try {
        supabaseClient.removeChannel(realtimeChannel);
      } catch (_) {
        // ignore cleanup errors
      }
      realtimeChannel = null;
    }
  }

  function renderOrders() {
    if (!state.myOrders.length) {
      els.ordersList.innerHTML =
        '<div class="empty-state"><i data-lucide="clipboard-list"></i><p>No orders yet</p><span>Your orders will appear here after you place them.</span></div>';
      els.ordersStatus.textContent = "";
      refreshIcons();
      return;
    }

    els.ordersStatus.textContent = `${state.myOrders.length} order${state.myOrders.length === 1 ? "" : "s"} found`;

    els.ordersList.innerHTML = state.myOrders
      .map(
        (order) => `
      <div class="order-card" data-order-id="${order.id}">
        <div class="order-card-header">
          <span class="order-id">${escapeHtml(order.client_order_id)}</span>
          <span class="order-status status-${order.status}">${statusLabel(order.status)}</span>
        </div>
        <div class="order-card-body">
          <div class="order-meta">
            <span><i data-lucide="calendar"></i> ${formatDate(order.created_at)}</span>
            <span><i data-lucide="truck"></i> ${fulfillmentLabel(order.fulfillment_method)}</span>
          </div>
          <div class="order-summary-line">
            <span>${order.item_count} item${order.item_count === 1 ? "" : "s"}</span>
            <span class="order-total">${formatOrderTotal(order)}</span>
          </div>
          <div class="order-items-preview">
            ${previewItems(order.items)}
          </div>
        </div>
        <button class="order-detail-btn" data-action="toggle-detail" data-order-id="${order.id}">
          <i data-lucide="${state.expandedOrders.has(String(order.id)) ? 'chevron-up' : 'chevron-down'}"></i> ${state.expandedOrders.has(String(order.id)) ? 'Hide Details' : 'View Details'}
        </button>
        <div class="order-detail-inline" data-detail-id="${order.id}"${state.expandedOrders.has(String(order.id)) ? '' : ' hidden'}>
          ${buildDetailHTML(order)}
        </div>
      </div>
    `,
      )
      .join("");

    // Bind toggle events
    els.ordersList.querySelectorAll("[data-action='toggle-detail']").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const orderId = btn.dataset.orderId;
        if (state.expandedOrders.has(orderId)) {
          state.expandedOrders.delete(orderId);
        } else {
          state.expandedOrders.add(orderId);
        }
        // Just re-render this one card to keep it simple
        renderOrders();
      });
    });

    refreshIcons();
  }

  function buildDetailHTML(order) {
    const items = order.items || [];
    return `
      <div class="detail-section">
        <div class="detail-row">
          <span>Order ID</span>
          <strong>${escapeHtml(order.client_order_id)}</strong>
        </div>
        <div class="detail-row">
          <span>Status</span>
          <span class="order-status status-${order.status}">${statusLabel(order.status)}</span>
        </div>
        <div class="detail-row">
          <span>Date</span>
          <span>${formatDateTime(order.created_at)}</span>
        </div>
        <div class="detail-row">
          <span>Type</span>
          <span>${fulfillmentLabel(order.fulfillment_method)}</span>
        </div>
        ${order.address ? `<div class="detail-row"><span>Address</span><span>${escapeHtml(order.address)}</span></div>` : ""}
        ${order.note ? `<div class="detail-row"><span>Note</span><span>${escapeHtml(order.note)}</span></div>` : ""}
      </div>
      <div class="detail-section">
        <h4>Items</h4>
        <div class="detail-items">
          ${items
            .map(
              (item) => `
            <div class="detail-item">
              <div class="detail-item-info">
                <span class="detail-item-name">${escapeHtml(item.name)}</span>
                <span class="detail-item-qty">x${item.quantity}</span>
              </div>
              <div class="detail-item-prices">
                <span>${formatDetailPrice(item)}</span>
                <small>${formatDetailSecondaryPrice(item)}</small>
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
      <div class="detail-section detail-totals">
        <div class="detail-row">
          <span>Total (${order.currency || "USD"})</span>
          <strong>${formatOrderTotal(order)}</strong>
        </div>
      </div>
      <div class="detail-section">
        <div class="detail-row">
          <span>Customer</span>
          <span>${escapeHtml(order.customer_name || "-")}</span>
        </div>
        <div class="detail-row">
          <span>Phone</span>
          <span>${escapeHtml(order.phone || "-")}</span>
        </div>
      </div>
    `;
  }

  // ============================================================
  // Image Lightbox
  // ============================================================

  function openLightbox(product) {
    els.lightboxName.textContent = product.name;
    els.lightboxImage.src = product.imageCandidates[0] || "image/logo.JPG";
    els.lightboxImage.alt = product.name;
    els.lightboxPrice.innerHTML = `
      <strong>${formatPrice(product)}</strong>
      <small>${formatSecondaryPrice(product)}</small>
    `;
    els.imageLightbox.classList.add("is-open");
    refreshIcons();
  }

  function closeLightbox() {
    els.imageLightbox.classList.remove("is-open");
  }

  // ============================================================
  // Order ID Generation (LL + YYMMDD + sequential 001, daily reset)
  // ============================================================

  async function nextOrderId() {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const prefix = `LL${yy}${mm}${dd}`;

    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from("orders")
          .select("client_order_id")
          .like("client_order_id", `${prefix}%`)
          .order("client_order_id", { ascending: false })
          .limit(1);

        if (error) throw error;

        let seq = 1;
        if (data && data.length > 0) {
          const last = data[0].client_order_id;
          const lastSeq = parseInt(last.slice(-3));
          if (!isNaN(lastSeq)) seq = lastSeq + 1;
        }
        return `${prefix}${String(seq).padStart(3, "0")}`;
      } catch (error) {
        console.warn("Failed to generate sequential ID, falling back", error);
      }
    }

    // Fallback: timestamp-based ID
    const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(2, 14);
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `LL${stamp}${random}`;
  }

  // ============================================================
  // Menu loading
  // ============================================================

  async function loadMenuFromExcel() {
    if (!window.XLSX) throw new Error("SheetJS failed to load.");

    const menuFile = config.menuFile || "menu and price.xlsx";
    const response = await fetch(encodeURI(menuFile), { cache: "no-store" });
    if (!response.ok) throw new Error(`Menu fetch failed: ${response.status}`);

    const data = await response.arrayBuffer();
    const workbook = window.XLSX.read(data, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    return normalizeRows(rows);
  }

  function normalizeRows(rows) {
    const headerIndex = rows.findIndex((row) => {
      const labels = row.map((value) => normalizeLabel(value));
      return labels.includes("name") && labels.includes("type");
    });
    if (headerIndex < 0) throw new Error("Could not find menu header row.");

    const headers = rows[headerIndex].map((value) => normalizeLabel(value));
    const col = (...names) => {
      const normalized = names.map(normalizeLabel);
      return headers.findIndex((header) => normalized.includes(header));
    };

    const indexes = {
      no: col("no"),
      type: col("type", "category"),
      name: col("name"),
      khmer: col("khmer"),
      listPriceUsd: col("price"),
      shopPriceUsd: col("shop price $", "shop price usd"),
      shopPriceKhr: col("shop price ៛", "shop price khr"),
      promotion: col("promotion", "promo"),
    };

    return rows
      .slice(headerIndex + 1)
      .map((row, offset) => rowToProduct(row, indexes, offset))
      .filter(Boolean);
  }

  function rowToProduct(row, indexes, offset) {
    const name = cell(row, indexes.name);
    const type = cell(row, indexes.type);
    if (!name || !type) return null;

    const no = Number(cell(row, indexes.no)) || offset + 1;
    const listPriceUsd = numberCell(row, indexes.listPriceUsd);
    const priceUsd = numberCell(row, indexes.shopPriceUsd) || listPriceUsd || 0;
    const priceKhr = Math.round(numberCell(row, indexes.shopPriceKhr) || priceUsd * 4000);
    const promotion = Boolean(cell(row, indexes.promotion));

    return {
      id: `${no}-${slugify(name)}`,
      no,
      type,
      name,
      khmer: cell(row, indexes.khmer),
      listPriceUsd,
      priceUsd,
      priceKhr,
      promotion,
      imageCandidates: imageCandidates(name),
    };
  }

  function render() {
    renderCategories();
    renderProducts();
    renderCart();
    updateAddressLabel();
  }

  function renderCategories() {
    els.categoryTabs.replaceChildren(
      ...state.categories.map((category) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `category-tab${category === state.activeCategory ? " is-active" : ""}`;
        button.dataset.category = category;
        button.textContent = category;
        return button;
      }),
    );
  }

  function renderProducts() {
    const products = filteredProducts();
    els.menuGrid.replaceChildren(...products.map(renderProductCard));
    if (!products.length) {
      const empty = document.createElement("div");
      empty.className = "empty-cart";
      empty.textContent = "No drinks match this search.";
      els.menuGrid.append(empty);
    }
    refreshIcons();
  }

  function renderProductCard(product) {
    const item = state.cart.get(product.id);
    const quantity = item ? item.quantity : 0;
    const card = document.createElement("article");
    card.className = "product-card";

    const media = document.createElement("div");
    media.className = "product-media";
    const image = document.createElement("img");
    image.alt = product.name;
    image.style.cursor = "pointer";
    image.addEventListener("click", () => openLightbox(product));
    attachImageFallback(image, product.imageCandidates);
    media.append(image);

    const badgeRow = document.createElement("div");
    badgeRow.className = "badge-row";
    badgeRow.append(makeBadge(product.type));
    if (product.promotion) badgeRow.append(makeBadge("Promo", "promo"));
    media.append(badgeRow);

    const body = document.createElement("div");
    body.className = "product-body";

    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "product-name";
    title.textContent = product.name;
    const khmer = document.createElement("p");
    khmer.className = "product-khmer";
    khmer.textContent = product.khmer || "";
    copy.append(title, khmer);

    const footer = document.createElement("div");
    footer.className = "product-footer";

    const price = document.createElement("div");
    price.className = "price";
    price.innerHTML = `<strong>${formatPrice(product)}</strong><small>${formatSecondaryPrice(product)}</small>`;

    const control = document.createElement("div");
    control.className = "quantity-control";
    if (quantity > 0) {
      control.append(
        quantityButton(product.id, "decrease", "minus", "Remove one", "secondary"),
        quantityValue(quantity),
        quantityButton(product.id, "increase", "plus", "Add one"),
      );
    } else {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "add-button";
      add.dataset.action = "increase";
      add.dataset.id = product.id;
      add.innerHTML = '<i data-lucide="plus" aria-hidden="true"></i><span>Add</span>';
      control.append(add);
    }

    footer.append(price, control);
    body.append(copy, footer);
    card.append(media, body);
    return card;
  }

  function renderCart() {
    const entries = cartEntries();
    const totals = cartTotals(entries);

    els.cartCount.textContent = String(totals.quantity);
    els.summaryItems.textContent = String(totals.quantity);
    els.summaryTotal.textContent = formatTotals(totals);
    els.mobileCartLabel.textContent = totals.quantity
      ? `${totals.quantity} item${totals.quantity === 1 ? "" : "s"} in cart`
      : "Cart is empty";
    els.mobileCartTotal.textContent = formatTotals(totals);
    els.submitOrder.disabled = !entries.length || state.submitting;

    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "empty-cart";
      empty.textContent = "Add drinks to start an order.";
      els.cartItems.replaceChildren(empty);
      refreshIcons();
      return;
    }

    els.cartItems.replaceChildren(
      ...entries.map(({ product, quantity }) => {
        const line = document.createElement("div");
        line.className = "cart-line";

        const copy = document.createElement("div");
        const title = document.createElement("h3");
        title.textContent = product.name;
        const detail = document.createElement("p");
        detail.textContent = `${quantity} x ${formatPrice(product)}`;
        copy.append(title, detail);

        const side = document.createElement("div");
        const linePrice = document.createElement("div");
        linePrice.className = "line-price";
        linePrice.textContent = formatLineTotal(product, quantity);
        const control = document.createElement("div");
        control.className = "quantity-control";
        control.append(
          quantityButton(product.id, "decrease", "minus", "Remove one", "secondary"),
          quantityValue(quantity),
          quantityButton(product.id, "increase", "plus", "Add one"),
        );
        side.append(linePrice, control);

        line.append(copy, side);
        return line;
      }),
    );
    refreshIcons();
  }

  function filteredProducts() {
    return state.products.filter((product) => {
      const categoryMatch = state.activeCategory === "All" || product.type === state.activeCategory;
      const promoMatch = !state.promoOnly || product.promotion;
      const queryMatch =
        !state.query ||
        product.name.toLowerCase().includes(state.query) ||
        product.type.toLowerCase().includes(state.query) ||
        (product.khmer || "").toLowerCase().includes(state.query);
      return categoryMatch && promoMatch && queryMatch;
    });
  }

  function updateQuantity(productId, action) {
    const product = state.products.find((item) => item.id === productId);
    if (!product) return;

    const current = state.cart.get(productId);
    const nextQuantity =
      action === "increase" ? (current ? current.quantity : 0) + 1 : (current ? current.quantity : 0) - 1;

    if (nextQuantity <= 0) {
      state.cart.delete(productId);
    } else {
      state.cart.set(productId, { product, quantity: Math.min(nextQuantity, 99) });
    }

    renderProducts();
    renderCart();
    telegram && telegram.HapticFeedback && telegram.HapticFeedback.impactOccurred("light");
  }

  // ============================================================
  // Order Submission
  // ============================================================

  async function submitOrder(event) {
    event.preventDefault();
    const entries = cartEntries();
    if (!entries.length || state.submitting) return;

    const formData = new FormData(els.checkoutForm);
    const fulfillment = formData.get("fulfillment_method") || "pickup";
    const address = stringValue(formData.get("address"));
    if (fulfillment === "delivery" && !address) {
      showToast("Delivery address is required");
      return;
    }

    setSubmitting(true);

    try {
      const orderId = await nextOrderId();
      const order = buildOrder(entries, formData, orderId);

      if (supabaseClient) {
        // Insert order header
        const { data: insertedOrder, error: orderError } = await supabaseClient
          .from("orders")
          .insert(toSupabaseOrder(order))
          .select("id")
          .single();

        if (orderError) throw orderError;

        // Insert order_items (one row per product — matches orders_rows.csv structure)
        if (insertedOrder) {
          const orderItems = entries.map(({ product, quantity }) => ({
            order_id: insertedOrder.id,
            client_order_id: order.client_order_id,
            status: "new",
            customer_name: order.customer_name || null,
            telegram_user_id: order.telegram_user ? String(order.telegram_user.id) : null,
            phone: order.phone || null,
            fulfillment_method: order.fulfillment_method,
            currency: order.currency,
            subtotal_usd: order.subtotal_usd,
            subtotal_khr: order.subtotal_khr,
            quantity,
            name: product.name,
            unit_price_usd: product.priceUsd,
            unit_price_khr: product.priceKhr,
          }));

          const { error: itemsError } = await supabaseClient
            .from("order_items")
            .insert(orderItems);

          if (itemsError) console.warn("Failed to insert order_items:", itemsError);
        }

        showOrderSuccess(order, "Saved to Supabase");
      } else if (telegram && typeof telegram.sendData === "function") {
        telegram.sendData(JSON.stringify({ type: "latte_lab_order", order }));
        showOrderSuccess(order, "Sent to Telegram bot");
      } else {
        console.info("Demo order", order);
        showOrderSuccess(order, "Demo order created");
      }

      state.cart.clear();
      els.checkoutForm.reset();
      const user = telegram && telegram.initDataUnsafe && telegram.initDataUnsafe.user;
      if (user) els.customerName.value = [user.first_name, user.last_name].filter(Boolean).join(" ");
      renderProducts();
      renderCart();
      updateAddressLabel();
    } catch (error) {
      console.error(error);
      const message = error.message || "Order failed";
      els.submitNote.textContent = message;
      showToast(message);
      telegram && telegram.HapticFeedback && telegram.HapticFeedback.notificationOccurred("error");
    } finally {
      setSubmitting(false);
    }
  }

  function buildOrder(entries, formData, orderId) {
    const totals = cartTotals(entries);
    const telegramUser = telegram && telegram.initDataUnsafe ? telegram.initDataUnsafe.user || null : null;

    return {
      client_order_id: orderId,
      created_at: new Date().toISOString(),
      source: "telegram_web_app",
      customer_name: stringValue(formData.get("customer_name")),
      phone: stringValue(formData.get("phone")),
      fulfillment_method: stringValue(formData.get("fulfillment_method")) || "pickup",
      address: stringValue(formData.get("address")),
      note: stringValue(formData.get("note")),
      currency: state.currency,
      subtotal_usd: totals.usd,
      subtotal_khr: totals.khr,
      item_count: totals.quantity,
      items: entries.map(({ product, quantity }) => ({
        product_id: product.id,
        no: product.no,
        type: product.type,
        name: product.name,
        khmer: product.khmer,
        unit_price_usd: product.priceUsd,
        unit_price_khr: product.priceKhr,
        quantity,
        line_total_usd: roundMoney(product.priceUsd * quantity),
        line_total_khr: product.priceKhr * quantity,
        promotion: product.promotion,
      })),
      telegram_user: telegramUser,
    };
  }

  function toSupabaseOrder(order) {
    const user = order.telegram_user || {};
    return {
      client_order_id: order.client_order_id,
      source: order.source,
      telegram_user_id: user.id ? String(user.id) : null,
      telegram_username: user.username || null,
      telegram_first_name: user.first_name || null,
      telegram_last_name: user.last_name || null,
      customer_name: order.customer_name || null,
      phone: order.phone || null,
      fulfillment_method: order.fulfillment_method,
      address: order.address || null,
      note: order.note || null,
      currency: order.currency,
      subtotal_usd: order.subtotal_usd,
      subtotal_khr: order.subtotal_khr,
      item_count: order.item_count,
      items: order.items,
      telegram_user: order.telegram_user,
      raw_client: {
        branch: config.branchName || null,
        user_agent: navigator.userAgent,
        app_platform: telegram ? telegram.platform : "browser",
      },
    };
  }

  function showOrderSuccess(order, prefix) {
    els.submitNote.textContent = `${prefix}. Order ${order.client_order_id}`;
    showToast(`Order ${order.client_order_id} placed`);
    closeCart();
    telegram && telegram.HapticFeedback && telegram.HapticFeedback.notificationOccurred("success");
  }

  function setSubmitting(value) {
    state.submitting = value;
    els.submitOrder.disabled = value || !cartEntries().length;
    els.submitOrder.innerHTML = value
      ? '<i data-lucide="loader-circle" aria-hidden="true"></i>Submitting...'
      : '<i data-lucide="send" aria-hidden="true"></i>Place order';
    refreshIcons();
  }

  // ============================================================
  // Cart UI
  // ============================================================

  function openCart() {
    els.cartDrawer.classList.add("is-open");
    els.cartDrawer.setAttribute("aria-hidden", "false");
    els.drawerBackdrop.hidden = false;
    if (telegram && telegram.BackButton) {
      telegram.BackButton.show();
      telegram.BackButton.onClick(closeCart);
    }
  }

  function closeCart() {
    els.cartDrawer.classList.remove("is-open");
    els.cartDrawer.setAttribute("aria-hidden", "true");
    els.drawerBackdrop.hidden = true;
    if (telegram && telegram.BackButton) telegram.BackButton.hide();
  }

  function updateAddressLabel() {
    const value = new FormData(els.checkoutForm).get("fulfillment_method");
    els.addressField.firstChild.nodeValue = value === "delivery" ? "Delivery address" : "Address or table";
  }

  function cartEntries() {
    return Array.from(state.cart.values());
  }

  function cartTotals(entries) {
    return entries.reduce(
      (totals, { product, quantity }) => ({
        quantity: totals.quantity + quantity,
        usd: roundMoney(totals.usd + product.priceUsd * quantity),
        khr: totals.khr + product.priceKhr * quantity,
      }),
      { quantity: 0, usd: 0, khr: 0 },
    );
  }

  // ============================================================
  // Formatting helpers
  // ============================================================

  function formatPrice(product) {
    if (state.currency === "KHR") return `${currencyFormatters.KHR.format(product.priceKhr)} KHR`;
    return currencyFormatters.USD.format(product.priceUsd);
  }

  function formatSecondaryPrice(product) {
    if (state.currency === "KHR") return currencyFormatters.USD.format(product.priceUsd);
    return `${currencyFormatters.KHR.format(product.priceKhr)} KHR`;
  }

  function formatLineTotal(product, quantity) {
    if (state.currency === "KHR") return `${currencyFormatters.KHR.format(product.priceKhr * quantity)} KHR`;
    return currencyFormatters.USD.format(roundMoney(product.priceUsd * quantity));
  }

  function formatTotals(totals) {
    if (state.currency === "KHR") return `${currencyFormatters.KHR.format(totals.khr)} KHR`;
    return currencyFormatters.USD.format(totals.usd);
  }

  function formatOrderTotal(order) {
    if (order.currency === "KHR") return `${currencyFormatters.KHR.format(Number(order.subtotal_khr))} KHR`;
    return currencyFormatters.USD.format(Number(order.subtotal_usd));
  }

  function formatDetailPrice(item) {
    if (state.currency === "KHR") return `${currencyFormatters.KHR.format(item.unit_price_khr)} KHR`;
    return currencyFormatters.USD.format(item.unit_price_usd);
  }

  function formatDetailSecondaryPrice(item) {
    if (state.currency === "KHR") return currencyFormatters.USD.format(item.unit_price_usd);
    return `${currencyFormatters.KHR.format(item.unit_price_khr)} KHR`;
  }

  function formatDate(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    } catch {
      return isoString;
    }
  }

  function formatDateTime(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleString("en-US", {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  }

  function statusLabel(status) {
    const map = {
      new: "New",
      accepted: "Accepted",
      preparing: "Preparing",
      ready: "Ready",
      completed: "Completed",
      cancelled: "Cancelled",
    };
    return map[status] || status;
  }

  function fulfillmentLabel(method) {
    const map = { pickup: "Pickup", dine_in: "Dine-in", delivery: "Delivery" };
    return map[method] || method;
  }

  function previewItems(items) {
    if (!items || !items.length) return "";
    const names = items.slice(0, 3).map((i) => `${escapeHtml(i.name)} x${i.quantity}`);
    if (items.length > 3) names.push(`+${items.length - 3} more`);
    return names.join(", ");
  }

  function makeBadge(text, extraClass) {
    const badge = document.createElement("span");
    badge.className = `badge${extraClass ? ` ${extraClass}` : ""}`;
    badge.textContent = text;
    return badge;
  }

  function quantityButton(productId, action, icon, label, extraClass) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `qty-button${extraClass ? ` ${extraClass}` : ""}`;
    button.dataset.id = productId;
    button.dataset.action = action;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
    return button;
  }

  function quantityValue(quantity) {
    const value = document.createElement("span");
    value.className = "qty-value";
    value.textContent = String(quantity);
    return value;
  }

  function attachImageFallback(image, candidates) {
    let index = 0;
    image.onerror = () => {
      index += 1;
      if (index < candidates.length) {
        image.src = candidates[index];
      } else {
        image.onerror = null;
        image.src = "image/logo.JPG";
        image.classList.add("is-fallback");
      }
    };
    image.src = candidates[0] || "image/logo.JPG";
  }

  function imageCandidates(name) {
    const aliases = {
      "Hot Caffe Condensed Milk": "Hot Caffe with Condensed Milk",
      "Iced Coffee Mint Latte": "Iced Mint Coffee Latte",
    };
    const bases = unique([
      name,
      aliases[name],
      name.replace("Caffe Condensed Milk", "Caffe with Condensed Milk"),
      name.replace("Coffee Mint", "Mint Coffee"),
    ].filter(Boolean));

    if (state.imageFiles.length) {
      const fileMap = new Map(
        state.imageFiles.map((file) => [imageKey(file.replace(/\.[^.]+$/, "")), file]),
      );
      const match = bases.map((base) => fileMap.get(imageKey(base))).find(Boolean);
      if (match) return [encodeURI(`image/${match}`), "image/logo.JPG"];
    }

    const extensions = ["PNG", "png", "JPG", "jpg", "JPEG", "jpeg"];
    return bases.flatMap((base) => extensions.map((ext) => encodeURI(`image/${base}.${ext}`)));
  }

  function imageKey(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function cell(row, index) {
    if (index < 0) return "";
    return stringValue(row[index]);
  }

  function numberCell(row, index) {
    if (index < 0) return 0;
    const value = row[index];
    if (typeof value === "number") return value;
    const parsed = Number(String(value || "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeLabel(value) {
    return stringValue(value).toLowerCase().replace(/\s+/g, " ");
  }

  function stringValue(value) {
    return value == null ? "" : String(value).trim();
  }

  function slugify(value) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function getTelegramUser() {
    return telegram && telegram.initDataUnsafe ? telegram.initDataUnsafe.user || null : null;
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
  }

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
  }
})();
