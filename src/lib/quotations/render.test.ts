import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ launch: vi.fn(), newPage: vi.fn(), route: vi.fn(), setContent: vi.fn(), evaluate: vi.fn(), pdf: vi.fn(), close: vi.fn() }));
vi.mock('playwright', () => ({ chromium: { launch: h.launch } }));
import { renderHtmlToPdf } from './render';

beforeEach(() => {
  vi.resetAllMocks();
  h.launch.mockResolvedValue({ newPage: h.newPage, close: h.close });
  h.newPage.mockResolvedValue({ route: h.route, setContent: h.setContent, evaluate: h.evaluate, pdf: h.pdf });
  h.pdf.mockResolvedValue(Buffer.from('dummy-pdf'));
});
describe('PDF browser isolation', () => {
  it('disables document scripts and aborts requests before loading untrusted content', async () => {
    const html = '<script>fetch("https://example.invalid/")</script><img src="http://127.0.0.1/">';
    await expect(renderHtmlToPdf(html)).resolves.toEqual(Buffer.from('dummy-pdf'));
    expect(h.newPage).toHaveBeenCalledWith({ javaScriptEnabled: false, serviceWorkers: 'block' });
    expect(h.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    const abort = vi.fn();
    await h.route.mock.calls[0][1]({ abort });
    expect(abort).toHaveBeenCalledOnce();
    expect(h.route.mock.invocationCallOrder[0]).toBeLessThan(h.setContent.mock.invocationCallOrder[0]);
    expect(h.setContent).toHaveBeenCalledWith(html, { waitUntil: 'load' });
    expect(h.close).toHaveBeenCalledOnce();
  });
  it('closes the browser if document rendering fails', async () => {
    h.setContent.mockRejectedValueOnce(new Error('dummy rendering failure'));
    await expect(renderHtmlToPdf('<p>dummy</p>')).rejects.toThrow('dummy rendering failure');
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.pdf).not.toHaveBeenCalled();
  });
});
