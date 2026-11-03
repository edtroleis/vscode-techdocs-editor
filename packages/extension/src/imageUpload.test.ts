import { imageFileName, imageProblem, imageTarget, downloadImage } from './imageUpload';

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

describe('downloadImage (spec 05, C3)', () => {
  const reply = (body: string, type: string, status = 200) =>
    (async () => new Response(body, { status, headers: { 'content-type': type } })) as unknown as typeof fetch;

  it('baixa a imagem com o nome do arquivo do endereço', async () => {
    const image = await downloadImage('https://wiki.example.org/download/attachments/1/diagrama.png?version=1&api=v2', 5, reply('png', 'image/png'));
    expect(image).toMatchObject({ name: 'diagrama.png', mime: 'image/png' });
    expect(image.data.byteLength).toBe(3);
  });

  it('põe a extensão pelo tipo quando o endereço não tem', async () => {
    expect((await downloadImage('https://cdn.example.org/blob/abc123', 5, reply('x', 'image/jpeg'))).name).toBe('abc123.jpg');
  });

  it('página de login (HTML) volta com o tipo, para o envio recusar; erro HTTP e outro protocolo falham', async () => {
    expect((await downloadImage('https://wiki.example.org/a.png', 5, reply('<html>', 'text/html; charset=utf-8'))).mime).toBe('text/html');
    await expect(downloadImage('https://wiki.example.org/a.png', 5, reply('', 'text/html', 401))).rejects.toThrow('HTTP 401');
    await expect(downloadImage('file:///etc/passwd', 5, reply('', 'image/png'))).rejects.toThrow();
  });
});
