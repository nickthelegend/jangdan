/** Brand fonts (OFL, from @fontsource): Familjen Grotesk for words, Kode Mono for numbers and marks. */
export const SANS = '"Familjen Grotesk", system-ui, sans-serif';
export const MONO = '"Kode Mono", ui-monospace, monospace';

let loaded: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  if (loaded) return loaded;
  const base = import.meta.env.BASE_URL;
  const faces = [
    new FontFace('Familjen Grotesk', `url(${base}fonts/familjen-grotesk-latin-400-normal.woff2)`, { weight: '400' }),
    new FontFace('Familjen Grotesk', `url(${base}fonts/familjen-grotesk-latin-600-normal.woff2)`, { weight: '600' }),
    new FontFace('Familjen Grotesk', `url(${base}fonts/familjen-grotesk-latin-700-normal.woff2)`, { weight: '700' }),
    new FontFace('Kode Mono', `url(${base}fonts/kode-mono-latin-400-normal.woff2)`, { weight: '400' }),
    new FontFace('Kode Mono', `url(${base}fonts/kode-mono-latin-600-normal.woff2)`, { weight: '600' }),
  ];
  loaded = Promise.all(
    faces.map(async (f) => {
      await f.load();
      document.fonts.add(f);
    }),
  ).then(() => undefined);
  return loaded;
}
