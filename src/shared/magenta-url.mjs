export const MAGENTA_HOME = 'https://www.magenta.tv/';

// MagentaTV itself, its former web player, and the Telekom sign-in.
const PAGE_DOMAINS = ['magenta.tv', 'magentatv.de'];
const SIGN_IN_DOMAINS = ['telekom.com', 'telekom.de'];

function belongsTo(host, domains) {
  const normalized = String(host || '').toLowerCase();
  return domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

export function isMagentaHost(host) {
  return belongsTo(host, PAGE_DOMAINS) || belongsTo(host, SIGN_IN_DOMAINS);
}

// Accepts a MagentaTV link or the name itself, which opens the start page.
export function parseMagentaInput(input) {
  const text = String(input || '').trim();
  if (/^magenta\s*tv$/i.test(text)) return { platform: 'magenta', url: MAGENTA_HOME };
  if (!/^(https?:\/\/)?([\w-]+\.)*(magenta\.tv|magentatv\.de)(\/|$)/i.test(text)) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!belongsTo(url.hostname, PAGE_DOMAINS)) return null;
  // The former web player only redirects to the start page.
  if (belongsTo(url.hostname, ['magentatv.de'])) return { platform: 'magenta', url: MAGENTA_HOME };
  url.protocol = 'https:';
  return { platform: 'magenta', url: url.href };
}
