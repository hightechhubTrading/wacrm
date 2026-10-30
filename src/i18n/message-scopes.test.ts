import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';
import {
  routeMessageScopes,
  routeMessages,
  sharedMessages,
  type MessageRoute,
} from './message-scopes';

const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile).config;
const options = ts.convertCompilerOptionsFromJson(
  config.compilerOptions,
  process.cwd()
).options;
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : /\.[jt]sx?$/.test(entry.name) && !entry.name.includes('.test.')
        ? [join(directory, entry.name)]
        : []
  );
}
function namespaces(roots: string[]) {
  const seen = new Set<string>(),
    found = new Set<string>();
  function walk(file: string) {
    file = resolve(file);
    if (
      seen.has(file) ||
      file.includes('/node_modules/') ||
      !/\.[jt]sx?$/.test(file)
    )
      return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(
      /(?:useTranslations|getTranslations)\(\s*['"]([^'"]+)['"]/g
    ))
      found.add(match[1]);
    for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
      const resolvedModule = ts.resolveModuleName(
        imported.fileName,
        file,
        options,
        ts.sys
      ).resolvedModule;
      if (resolvedModule) walk(resolvedModule.resolvedFileName);
    }
  }
  roots.forEach(walk);
  return [...found];
}
function lookup(messages: unknown, path: string) {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[key]
          : undefined,
      messages
    );
}

describe('route translation payloads', () => {
  it.each(Object.keys(routeMessageScopes) as MessageRoute[])(
    'covers all transitive screens and dialogs in %s',
    (route) => {
      const consumed = namespaces(files(`src/app/(dashboard)/${route}`));
      for (const catalog of [en, ar]) {
        const selected = routeMessages(catalog, route);
        for (const namespace of consumed)
          expect(lookup(selected, namespace), namespace).toBeDefined();
      }
    }
  );
  it('keeps every shared shell and auth namespace available', () => {
    const consumed = namespaces([
      'src/app/layout.tsx',
      'src/app/(dashboard)/dashboard-shell.tsx',
      ...files('src/app/(auth)'),
      ...files('src/app/join'),
    ]);
    for (const catalog of [en, ar])
      for (const namespace of consumed)
        expect(
          lookup(sharedMessages(catalog), namespace),
          namespace
        ).toBeDefined();
  });
  it('reduces dashboard and login catalogs while retaining nested Arabic messages', () => {
    expect(JSON.stringify(routeMessages(en, 'dashboard')).length).toBeLessThan(
      JSON.stringify(en).length / 2
    );
    expect(JSON.stringify(sharedMessages(en)).length).toBeLessThan(
      JSON.stringify(en).length / 4
    );
    expect(
      lookup(routeMessages(ar, 'settings'), 'Settings.appearance')
    ).toEqual(ar.Settings.appearance);
  });
});
