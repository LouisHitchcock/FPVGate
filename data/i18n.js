class I18n {
  constructor() {
    this.locales = {};
    this.currentLang = localStorage.getItem("fpvgate_lang") || this.detectLanguage();
    this.fallbackLang = "en";
  }

  detectLanguage() {
    const lang = navigator.language || navigator.userLanguage;
    if (lang.startsWith("zh")) {
      return "zh-CN";
    }
    if (lang.startsWith("fr")) {
      return "fr";
    }
    if (lang.startsWith("es")) {
      return "es";
    }
    if (lang.startsWith("de")) {
      return "de";
    }
    return "en";
  }

  async setLanguage(lang) {
    this.currentLang = lang;
    localStorage.setItem("fpvgate_lang", lang);
    await this.loadLocale(lang);
    this.translatePage();
    document.documentElement.lang = lang;
  }

  async loadLocale(lang) {
    if (this.locales[lang]) return;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      // Use absolute path for mobile browser compatibility (Safari/Firefox).
      // The timeout keeps a stalled catalogue request from holding up the app.
      const response = await fetch(`/locales/${lang}.json`, {
        cache: 'no-cache',
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      this.locales[lang] = await response.json();
      console.log(`[i18n] Loaded locale: ${lang}`);
      // Keep English resident so t() can fall back per key for strings that
      // exist in en.json but have not been translated yet.
      if (lang !== this.fallbackLang) {
        await this.loadLocale(this.fallbackLang);
      }
    } catch (error) {
      console.error(`[i18n] Failed to load locale: ${lang}`, error);
      if (lang !== this.fallbackLang) {
        console.log(`[i18n] Falling back to: ${this.fallbackLang}`);
        await this.loadLocale(this.fallbackLang);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Walk a dotted key through one locale table. Returns undefined if any
  // segment is missing, so the caller can decide whether to fall back.
  resolve(locale, keys) {
    let value = locale;
    for (const k of keys) {
      if (value && value[k]) {
        value = value[k];
      } else {
        return undefined;
      }
    }
    return value;
  }

  t(key, params = {}) {
    const keys = key.split(".");
    const current = this.locales[this.currentLang];
    const fallback = this.locales[this.fallbackLang];

    // Guard against both locales being undefined
    if (!current && !fallback) {
      console.warn(`No locales loaded, returning key: ${key}`);
      return key;
    }

    // Fall back per key, not per file. A translation added to en.json but not
    // yet to de/es/fr/zh-CN would otherwise render as the raw dotted key.
    let value = this.resolve(current, keys);
    if (value === undefined) {
      value = this.resolve(fallback, keys);
    }
    if (value === undefined) {
      value = key;
    }

    if (typeof value === "string") {
      Object.keys(params).forEach((param) => {
        value = value.replaceAll(`{${param}}`, params[param]);
      });
    }

    return value;
  }

  translatePage() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const paramsAttr = el.getAttribute("data-i18n-params");
      let params = {};

      if (paramsAttr) {
        try {
          params = JSON.parse(paramsAttr);
        } catch (e) {
          console.error("Failed to parse i18n params:", e);
        }
      }

      const translation = this.t(key, params);
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.placeholder = translation;
      } else {
        el.innerHTML = translation;
      }
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      el.placeholder = this.t(key);
    });

    // Attributes that cannot carry text content, such as tooltips and
    // optgroup labels, are translated in place.
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = this.t(el.getAttribute("data-i18n-title"));
    });
    document.querySelectorAll("[data-i18n-label]").forEach((el) => {
      el.label = this.t(el.getAttribute("data-i18n-label"));
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", this.t(el.getAttribute("data-i18n-aria-label")));
    });

    // Update select options if needed
    document.querySelectorAll("[data-i18n-options]").forEach((el) => {
      const key = el.getAttribute("data-i18n-options");
      const options = this.t(key);
      if (Array.isArray(options)) {
        // This part needs specific implementation based on how options are structured
      }
    });
  }

  async init() {
    await this.loadLocale(this.currentLang);
    this.translatePage();

    // Add language switcher event listener if it exists
    const langSelector = document.getElementById("languageSelector");
    if (langSelector) {
      langSelector.value = this.currentLang;
      langSelector.addEventListener("change", (e) => {
        this.setLanguage(e.target.value);
      });
    }
  }
}

const i18n = new I18n();
document.addEventListener("DOMContentLoaded", () => {
  // Exposed so the app can wait for the catalogue before its first render;
  // otherwise dynamically built tables would show raw dotted keys.
  i18n.ready = i18n.init();
});
