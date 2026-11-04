export const MAGENTA_HOME = 'https://www.magenta.tv/';
// The channel list of the TV section; a tile starts that channel live.
export const MAGENTA_TV_PAGE = 'https://www.magenta.tv/url/tvhubs.t-online.de/v3/ftv-web/UnstructuredGrid/310494';

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

// Accepts a MagentaTV link or the name itself, which opens the channel list.
export function parseMagentaInput(input) {
  const text = String(input || '').trim();
  if (/^magenta\s*tv$/i.test(text)) return { platform: 'magenta', url: MAGENTA_TV_PAGE };
  if (!/^(https?:\/\/)?([\w-]+\.)*(magenta\.tv|magentatv\.de)(\/|$)/i.test(text)) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!belongsTo(url.hostname, PAGE_DOMAINS)) return null;
  // The former web player only redirects, so it opens the channel list.
  if (belongsTo(url.hostname, ['magentatv.de'])) return { platform: 'magenta', url: MAGENTA_TV_PAGE };
  url.protocol = 'https:';
  return { platform: 'magenta', url: url.href };
}
