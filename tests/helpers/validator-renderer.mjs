import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as Vue from 'vue';

const require = createRequire(import.meta.url);
export const root = fileURLToPath(new URL('../../', import.meta.url));

// Compile the shipped SFC, including its real template and event handlers.
// Dependency substitutions isolate browser services; no product export is added.
export async function loadProduct(path, dependencies = {}) {
  const filename = `${root}${path}`;
  const source = await readFile(filename, 'utf8');
  const content = path.endsWith('.vue')
    ? compileScript(parse(source, { filename }).descriptor, {
        id: path,
        inlineTemplate: true,
      }).content
    : source;
  const compiled = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const resolve = (name) =>
    name === 'vue'
      ? Vue
      : Object.hasOwn(dependencies, name)
        ? dependencies[name]
        : require(name);
  new Function('require', 'module', 'exports', compiled)(
    resolve,
    module,
    module.exports
  );
  return module.exports;
}

function node(type, text = '') {
  return {
    type,
    text,
    props: {},
    style: {},
    children: [],
    parent: null,
    get options() {
      return this.children.filter((c) => c.type === 'option');
    },
    addEventListener() {},
    removeEventListener() {},
  };
}

function detach(child) {
  if (child.parent) {
    const siblings = child.parent.children;
    siblings.splice(siblings.indexOf(child), 1);
    child.parent = null;
  }
}

export const renderer = Vue.createRenderer({
  createElement: (type) => node(type),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (element, text) => {
    element.text = text;
  },
  setElementText: (element, text) => {
    element.text = text;
    element.children = [];
  },
  patchProp: (element, key, previous, value) => {
    element.props[key] = value;
  },
  insert: (child, parent, anchor = null) => {
    detach(child);
    const index = anchor
      ? parent.children.indexOf(anchor)
      : parent.children.length;
    parent.children.splice(index, 0, child);
    child.parent = parent;
  },
  remove: detach,
  parentNode: (element) => element.parent,
  nextSibling: (element) => {
    const siblings = element.parent?.children || [];
    return siblings[siblings.indexOf(element) + 1] || null;
  },
});

export function text(element) {
  return element.type === '#comment'
    ? ''
    : element.text + element.children.map(text).join('');
}

export function findAll(element, predicate) {
  return [
    ...(predicate(element) ? [element] : []),
    ...element.children.flatMap((child) => findAll(child, predicate)),
  ];
}

export function rows(container) {
  return findAll(container, (element) => element.type === 'tbody')
    .flatMap((body) => body.children.filter((child) => child.type === 'tr'))
    .map((element) => text(element).trim());
}

export function mount(component, props) {
  const container = node('root');
  const app = renderer.createApp({ render: () => Vue.h(component, props) });
  app.config.globalProperties.$t = (key) => key;
  app.component('RouterLink', {
    props: ['to'],
    setup:
      (link, { slots }) =>
      () =>
        Vue.h('a', { href: link.to }, slots.default?.()),
  });
  app.directive('lazy', {});
  app.mount(container);
  return { app, container };
}

export function button(container, label) {
  const result = findAll(
    container,
    (element) => element.type === 'button' && text(element).trim() === label
  )[0];
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

export function click(element) {
  if (element.props.disabled)
    throw new Error('Cannot click a disabled control');
  return element.props.onClick();
}
