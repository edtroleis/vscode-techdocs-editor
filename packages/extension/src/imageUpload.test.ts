import { downloadImage, isWebUrl } from './imageUpload';

describe('downloadImage (spec 05, C3)', () => {
  it('o que não vem como imagem (a página de login de um endereço privado) é recusado, mesmo com .png no nome', async () => {
    await expect(downloadImage('https://privado.example.org/foto.png', 5, reply('<html>login</html>', 'text/html'))).rejects.toThrow('notAnImage');
  });

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

  it('erro HTTP e outro protocolo falham', async () => {
    await expect(downloadImage('https://wiki.example.org/a.png', 5, reply('', 'text/html', 401))).rejects.toThrow('HTTP 401');
    await expect(downloadImage('file:///etc/passwd', 5, reply('', 'image/png'))).rejects.toThrow();
  });

  it('sem content-length: para de ler no limite', async () => {
    const big = new Uint8Array(2 * 1024 * 1024);
    const get = (async () => new Response(big, { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
    await expect(downloadImage('https://cdn.example.org/grande.png', 1, get)).rejects.toThrow('tooLarge');
  });

  it('nome com % inválido não quebra o download', async () => {
    expect((await downloadImage('https://cdn.example.org/a%E0.png', 5, reply('x', 'image/png'))).name).toBe('a%E0.png');
  });
});

describe('isWebUrl', () => {
  it('só http(s)', () => {
    expect(isWebUrl('https://github.com/o/r/pull/1')).toBe(true);
    expect(isWebUrl('http://localhost:7007')).toBe(true);
    expect(isWebUrl('command:workbench.action.reloadWindow')).toBe(false);
    expect(isWebUrl('file:///etc/passwd')).toBe(false);
    expect(isWebUrl('não é endereço')).toBe(false);
  });
});
