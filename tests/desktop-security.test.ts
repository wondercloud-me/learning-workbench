import {EventEmitter} from 'node:events';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {createDesktopSecurity, installShellNavigationGuards} from '../src/electron/security';

describe('desktop shell trust boundary', () => {
  it('trusts only the packaged shell documents on the exact growth authority', () => {
    const policy = createDesktopSecurity({isPackaged: true, devServerUrl: 'https://attacker.example/'});
    expect(policy.launchUrl).toBe('growth://app/index.html');
    for (const url of ['growth://app/', 'growth://app/index.html', 'growth://app/index.html?view=lab#code']) {
      expect(policy.isTrustedShellUrl(url), url).toBe(true);
    }
    for (const url of [
      'growth://app.attacker.example/index.html', 'growth://attacker/index.html',
      'growth://app:8000/index.html', 'growth://user@app/index.html',
      'growth://app/assets/page.html', 'growth://app/index.html/other',
      'https://app/index.html', 'http://127.0.0.1:5173/', 'file:///index.html',
      'javascript:alert(1)', 'data:text/html,hello', 'about:blank', 'invalid url'
    ]) expect(policy.isTrustedShellUrl(url), url).toBe(false);
  });

  it.each(['http://127.0.0.1:5173/', 'http://localhost:5173/', 'https://[::1]:5173/'])('allows a configured development origin on loopback: %s', url => {
    const policy = createDesktopSecurity({isPackaged: false, devServerUrl: url});
    expect(policy.launchUrl).toBe(url);
    expect(policy.isTrustedShellUrl(new URL('/src/renderer/main.tsx?test=1', url).href)).toBe(true);
    expect(policy.isTrustedShellUrl('http://127.0.0.1:5174/')).toBe(false);
    expect(policy.isTrustedShellUrl('http://localhost.attacker.example:5173/')).toBe(false);
    expect(policy.isTrustedShellUrl('https://attacker.example/')).toBe(false);
    expect(policy.isTrustedShellUrl('growth://app/index.html')).toBe(false);
    expect(policy.isTrustedShellUrl(`blob:${new URL(url).origin}/untrusted-document`)).toBe(false);
    expect(policy.isTrustedShellUrl(new URL('/?source=external', url).href.replace('://', '://user:password@'))).toBe(false);
  });

  it.each([
    'https://attacker.example/', 'http://192.168.1.2:5173/',
    'http://localhost.attacker.example:5173/', 'http://user:password@localhost:5173/',
    'file:///tmp/index.html', 'javascript:alert(1)', 'not a url'
  ])('rejects an unsafe development server configuration: %s', devServerUrl => {
    expect(() => createDesktopSecurity({isPackaged: false, devServerUrl})).toThrow(/本机/);
  });

  it('requires both the exact main frame identity and a currently trusted frame URL for IPC', () => {
    const policy = createDesktopSecurity({isPackaged: true});
    const frame = {url: 'growth://app/index.html'};
    const contents = {mainFrame: frame};
    expect(() => policy.assertTrustedIpc({sender: contents, senderFrame: frame}, contents)).not.toThrow();
    expect(() => policy.assertTrustedIpc({sender: {}, senderFrame: frame}, contents)).toThrow();
    expect(() => policy.assertTrustedIpc({sender: contents, senderFrame: {url: frame.url}}, contents)).toThrow();
    expect(() => policy.assertTrustedIpc({sender: contents, senderFrame: null}, contents)).toThrow();
    expect(() => policy.assertTrustedIpc({sender: contents, senderFrame: frame}, null)).toThrow();
    frame.url = 'https://www.runoob.com/';
    expect(() => policy.assertTrustedIpc({sender: contents, senderFrame: frame}, contents)).toThrow();
  });

  it('blocks remote navigation and redirects and denies additional windows', () => {
    const policy = createDesktopSecurity({isPackaged: true});
    let windowOpen: (() => {action: 'deny'}) | undefined;
    const contents = Object.assign(new EventEmitter(), {setWindowOpenHandler: (handler: () => {action: 'deny'}) => {windowOpen = handler;}});
    installShellNavigationGuards(contents, policy);
    for (const eventName of ['will-navigate', 'will-redirect']) {
      let prevented = false;
      contents.emit(eventName, {preventDefault: () => {prevented = true;}}, 'https://attacker.example/');
      expect(prevented, eventName).toBe(true);
      prevented = false;
      contents.emit(eventName, {preventDefault: () => {prevented = true;}}, 'growth://app/index.html#lab');
      expect(prevented, eventName).toBe(false);
    }
    expect(windowOpen?.()).toEqual({action: 'deny'});
    let previewPrevented = false;
    contents.emit('will-redirect', {url: 'http://127.0.0.1:3000/page', isMainFrame: false, preventDefault: () => {previewPrevented = true;}});
    expect(previewPrevented).toBe(false);
    let mainPrevented = false;
    contents.emit('will-redirect', {url: 'https://attacker.example/', isMainFrame: true, preventDefault: () => {mainPrevented = true;}});
    expect(mainPrevented).toBe(true);
  });

  it('confines growth resources to dist and rejects other authorities and decoded traversal', () => {
    const policy = createDesktopSecurity({isPackaged: true});
    const root = path.resolve('/tmp/学习 workbench/dist');
    expect(policy.resolveGrowthAsset('growth://app/', root)).toBe(path.join(root, 'index.html'));
    expect(policy.resolveGrowthAsset('growth://app/assets/runner.wasm?version=1', root)).toBe(path.join(root, 'assets/runner.wasm'));
    expect(policy.resolveGrowthAsset('growth://app/assets/字体.woff2', root)).toBe(path.join(root, 'assets/字体.woff2'));
    for (const url of [
      'growth://attacker/assets/code.js', 'growth://app.attacker.example/index.html',
      'growth://app:9000/index.html', 'growth://user@app/index.html', 'https://app/index.html',
      'growth://app/%2e%2e%2fsecrets', 'growth://app/%2e%2e%5csecrets', 'growth://app/%00', 'growth://app/%zz'
    ]) expect(policy.resolveGrowthAsset(url, root), url).toBeNull();
  });

  it('allows local Wasm and workers while withholding JavaScript eval and remote script/connect sources', () => {
    const policy = createDesktopSecurity({isPackaged: true});
    const directives = new Map(policy.contentSecurityPolicy.split(';').map(directive => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }));
    expect(directives.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(directives.get('connect-src')).toEqual(["'self'"]);
    expect(directives.get('worker-src')).toEqual(["'self'", 'blob:']);
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('frame-src')).toContain('http://127.0.0.1:*');
    expect(directives.get('frame-src')).not.toContain('https:');
    const dev = createDesktopSecurity({isPackaged: false, devServerUrl: 'http://localhost:5173/'});
    expect(dev.contentSecurityPolicy).toContain('connect-src \'self\' ws://localhost:5173');
    expect(dev.contentSecurityPolicy).not.toContain("'unsafe-eval'");
  });
});
