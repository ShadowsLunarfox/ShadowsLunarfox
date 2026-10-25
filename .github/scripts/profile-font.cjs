const fs = require('node:fs');
const path = require('node:path');

const PROFILE_FONT = 'Comic Neue, cursive';
const fontDirectory = path.resolve(__dirname, '../../assets/fonts/comic-neue');
const license = fs.readFileSync(path.join(fontDirectory, 'OFL.txt'), 'utf8');
const fontFaces = [['Regular', 400], ['Bold', 700]].map(([name, weight]) => {
  const data = fs.readFileSync(path.join(fontDirectory, `ComicNeue-${name}.woff2`)).toString('base64');
  return `@font-face { font-family: 'Comic Neue'; font-style: normal; font-weight: ${weight}; src: url(data:font/woff2;base64,${data}) format('woff2'); }`;
}).join('\n');
const escapeXml = value => value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
const embeddedFont = `<style id="profile-fonts">${fontFaces}</style><metadata id="profile-font-license">${escapeXml(license)}</metadata>`;

function applyProfileFont(svg) {
  if (!/<text\b/.test(svg)) return svg;
  const normalized = svg
    .replace(/<style\b[^>]*\bid="profile-fonts"[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<metadata\b[^>]*\bid="profile-font-license"[^>]*>[\s\S]*?<\/metadata>/g, '')
    .replace(/\bfont-family\s*=\s*(["'])[^\n]*?\1/g, `font-family="${PROFILE_FONT}"`)
    .replace(/\bfont-family\s*:\s*[^;}]+/g, `font-family: ${PROFILE_FONT}`)
    .replace(/(\bfont\s*:\s*[^;{}]*?\d(?:px|pt|rem|em|%)(?:\s*\/\s*[\d.]+(?:px|pt|rem|em|%)?)?\s+)[^;}]+/g, `$1${PROFILE_FONT}`)
    .replace(/^(\s*<svg)\b(?![^>]*\bfont-family\s*=)/, `$1 font-family="${PROFILE_FONT}"`);
  return normalized.replace(/<svg\b[^>]*>/, root => root + embeddedFont);
}

module.exports = { PROFILE_FONT, applyProfileFont };
