const fs = require('node:fs/promises');

// Language bars, pie slices and legend swatches use explicit fills. Text and
// contribution blocks use theme CSS and retain their light/dark colors.
function applyProfilePalette(svg) {
  const languageColors = {
    f1e05a: 'ffd166', // JavaScript
    '7355dd': 'd7c4f3', '178600': 'd7c4f3', // C#
    '663399': 'bbe8f2', '563d7c': 'bbe8f2', // CSS
    '3572a5': 'ffe9a3', // Python
    e34c26: 'ffaec5', // HTML
    '3178c6': 'b9edf2', // TypeScript
    f34b7d: 'b9edf2', // C++
    b07219: 'ffd3b0', // Java
    c1f12e: 'ffd3b0', // Batchfile
    '444444': '8b7a9e', // Other
  };
  const fallback = ['d7c4f3', 'b9edf2', 'ffd3b0', 'ffe9a3', 'ffaec5'];
  const themeColors = new Set(['3b2d4f', '615276', 'adbac7', '8b7a9e', 'ffd166', 'bbe8f2', ...fallback]);
  const replacements = new Map();
  function paletteColor(rawColor) {
    const color = rawColor.toLowerCase();
    if (themeColors.has(color)) return rawColor;
    if (!replacements.has(color)) replacements.set(color, languageColors[color] || fallback[replacements.size % fallback.length]);
    return replacements.get(color);
  }
  return svg.replace(/\bfill="#([0-9a-f]{6})"/gi, (_, color) => `fill="#${paletteColor(color)}"`)
    .replace(/style="([^"]*)"/g, (_, style) => `style="${style.replace(/\bfill:\s*#([0-9a-f]{6})/gi, (fill, color) => fill.replace(color, paletteColor(color)))}"`);
}

module.exports = { applyProfilePalette };
if (require.main === module) {
  (async () => {
    for (const file of process.argv.slice(2)) {
      await fs.writeFile(file, applyProfilePalette(await fs.readFile(file, 'utf8')));
      console.log(`Applied the pastel language palette to ${file}`);
    }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
