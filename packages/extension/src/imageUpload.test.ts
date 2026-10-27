import { imageFileName, imageProblem, imageTarget } from './imageUpload';

describe('imageProblem', () => {
  it('só imagens, até o limite', () => {
    expect(imageProblem('image/png', 1024, 5)).toBeUndefined();
    expect(imageProblem('image/svg+xml', 5 * 1024 * 1024, 5)).toBeUndefined();
    expect(imageProblem('application/pdf', 10, 5)).toBe('notAnImage');
    expect(imageProblem('', 10, 5)).toBe('notAnImage');
    expect(imageProblem('image/png', 5 * 1024 * 1024 + 1, 5)).toBe('tooLarge');
    expect(imageProblem('image/png', 1.5 * 1024 * 1024, 1)).toBe('tooLarge');
  });
});

describe('imageFileName', () => {
  it('minúsculas, sem espaços nem acentos', () => {
    expect(imageFileName('Captura de Tela (1).PNG')).toBe('captura-de-tela-1-.png');
    expect(imageFileName('diagrama-ação.svg')).toBe('diagrama-a-o.svg');
  });
});

describe('imageTarget', () => {
  it('em <docs>/assets, com link relativo à página', () => {
    expect(imageTarget('/w/wiki/docs/index.md', '/w/wiki/docs', 'a.png', 1)).toEqual({
      path: '/w/wiki/docs/assets/1-a.png',
      link: 'assets/1-a.png',
    });
    expect(imageTarget('/w/wiki/docs/guias/uso/x.md', '/w/wiki/docs', 'A B.png', 42)).toEqual({
      path: '/w/wiki/docs/assets/42-a-b.png',
      link: '../../assets/42-a-b.png',
    });
  });

  it('página fora de um site: assets ao lado dela', () => {
    expect(imageTarget('/w/notas/x.md', undefined, 'a.png', 7)).toEqual({
      path: '/w/notas/assets/7-a.png',
      link: 'assets/7-a.png',
    });
  });
});
