import de from "./lang/de.js";
import en from "./lang/en.js";
import es from "./lang/es.js";
import fr from "./lang/fr.js";
import it from "./lang/it.js";

// The flag goes through the languages in this order
const STRINGS = { fr, en, de, it, es };
export const LANGUAGES = Object.keys(STRINGS);

// The first language of the browser that the page speaks, or English
export const browserLanguage = () => navigator.languages.map((code) => code.slice(0, 2)).find((code) => LANGUAGES.includes(code)) ?? "en";

export let language = "fr";
export const t = (key) => STRINGS[language][key];

// Texts written in index.html carry their key in data-i18n, labels read out in data-i18n-label.
// Some texts hold links, so they're set as HTML: all of them are the page's own.
export function setLanguage(code) {
  language = code;
  document.documentElement.lang = code;
  for (const el of document.querySelectorAll("[data-i18n]")) el.innerHTML = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-label]")) el.ariaLabel = t(el.dataset.i18nLabel);
}
