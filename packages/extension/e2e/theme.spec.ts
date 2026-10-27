/** O editor visual acompanha o tema do VS Code (fundo e texto do editor). */
import { expect, openVisual, test, visual } from './vscode';

const luminance = (rgb: string) => {
  const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

for (const { theme, dark } of [
  { theme: 'Default Dark Modern', dark: true },
  { theme: 'Default Light Modern', dark: false },
]) {
  test.describe(theme, () => {
    test.use({ theme });

    test('fundo e texto do editor seguem o tema', async ({ vscode: { page } }) => {
      await openVisual(page, 'wiki/docs/index.md');
      const colors = await visual(page)
        .locator('.milkdown')
        .evaluate(element => {
          const style = getComputedStyle(element);
          return { background: style.backgroundColor, color: style.color, body: getComputedStyle(document.body).backgroundColor };
        });
      expect(colors.background).toBe(colors.body);
      expect(luminance(colors.background) < 0.5).toBe(dark);
      expect(luminance(colors.color) < 0.5).toBe(!dark);
    });
  });
}
