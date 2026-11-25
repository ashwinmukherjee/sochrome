// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The privacy rule as a lint rule: every way out of the page, by any spelling, allowed only in its one home.

const WHY = "(REBUILD §2.0)";
const REQUEST = `Requests are made only in src/data/ ${WHY}.`;
const STORED = `Nothing is stored ${WHY}.`;
const WINDOWS = `No other window is reached ${WHY}.`;

/** Globals that are a way out. `home` names the allowance a file needs to use one. */
const EXITS = {
  fetch: { message: REQUEST, home: "fetch" },
  XMLHttpRequest: { message: REQUEST },
  WebSocket: { message: `No sockets ${WHY}.` },
  EventSource: { message: `No event streams ${WHY}.` },
  WebTransport: { message: `No transports ${WHY}.` },
  RTCPeerConnection: { message: `No peer connections ${WHY}.` },
  BroadcastChannel: { message: `Nothing is sent to other pages ${WHY}.` },
  SharedWorker: {
    message: `The one worker is the reader, made with new Worker(new URL("./…", import.meta.url)) ${WHY}.`,
  },
  Image: { message: `No remote loads ${WHY}.` },
  Audio: { message: `No remote loads ${WHY}.` },
  importScripts: { message: `No remote loads ${WHY}.` },
  caches: { message: `The Cache API is used only in src/data/, for reference data ${WHY}.`, home: "caches" },
  localStorage: { message: STORED },
  sessionStorage: { message: STORED },
  indexedDB: { message: STORED },
  cookieStore: { message: STORED },
  name: { message: STORED },
  history: { message: `History is written only in src/app/router.ts ${WHY}.`, home: "history" },
  location: { message: `The address is read and written only in src/app/router.ts ${WHY}.`, home: "location" },
  console: { message: `Nothing is written to the console ${WHY}.` },
  open: { message: WINDOWS },
  opener: { message: WINDOWS },
  parent: { message: WINDOWS },
  top: { message: WINDOWS },
  frames: { message: WINDOWS },
  postMessage: {
    message: `Messages pass only between the page and its own worker, in src/worker/ ${WHY}.`,
    home: "postMessage",
  },
  Notification: { message: `Nothing is shown outside the page ${WHY}.` },
};

/** Names for the global object, and the two objects reached from it that have exits of their own. */
const GLOBAL_OBJECTS = new Set(["window", "self", "globalThis"]);
const DOCUMENT_EXITS = {
  title: { message: `The tab title is set only in src/app/router.ts, to the product's name ${WHY}.`, home: "title" },
  cookie: { message: STORED },
  location: EXITS.location,
  URL: EXITS.location,
  documentURI: EXITS.location,
  defaultView: { message: `The global object is reached only by its own name ${WHY}.` },
  write: { message: `No markup from strings ${WHY}.` },
  writeln: { message: `No markup from strings ${WHY}.` },
  execCommand: { message: `Nothing is copied out of the page ${WHY}.` },
};
const NAVIGATOR_EXITS = {
  sendBeacon: { message: `No beacons ${WHY}.` },
  serviceWorker: { message: `No service worker ${WHY}.` },
  clipboard: { message: `Nothing is copied out of the page ${WHY}.` },
  share: { message: `Nothing is shared out of the page ${WHY}.` },
  storage: { message: STORED },
};

/** Property names that are an exit on whatever object they are read from. */
const ANYWHERE = {
  fetch: EXITS.fetch,
  caches: EXITS.caches,
  localStorage: EXITS.localStorage,
  sessionStorage: EXITS.sessionStorage,
  indexedDB: EXITS.indexedDB,
  cookie: DOCUMENT_EXITS.cookie,
  console: EXITS.console,
  sendBeacon: NAVIGATOR_EXITS.sendBeacon,
  serviceWorker: NAVIGATOR_EXITS.serviceWorker,
  pushState: EXITS.history,
  replaceState: EXITS.history,
  defaultView: DOCUMENT_EXITS.defaultView,
  contentWindow: { message: WINDOWS },
  contentDocument: { message: WINDOWS },
  opener: { message: WINDOWS },
  importScripts: EXITS.importScripts,
  addModule: { message: `No remote loads ${WHY}.` },
  insertAdjacentHTML: { message: `No markup from strings ${WHY}.` },
  getDirectory: { message: STORED },
  showSaveFilePicker: { message: STORED },
};

/** Properties and attributes that make an element load or send something. */
const LOADING_PROPS = new Set(["src", "srcset", "href", "action", "formAction", "ping", "poster", "srcdoc", "innerHTML", "outerHTML"]); // prettier-ignore
const LOADING_ATTRS = new Set(["src", "srcset", "href", "xlink:href", "action", "formaction", "ping", "poster", "srcdoc", "data", "background"]); // prettier-ignore
const LOADING_TAGS = new Set(["script", "iframe", "frame", "object", "embed", "link", "meta", "base", "form", "img", "image", "video", "audio", "source", "track"]); // prettier-ignore
const JSX_BANNED = new Set(["script", "iframe", "frame", "object", "embed", "link", "meta", "base", "form"]);
const JSX_MEDIA = new Set(["img", "image", "video", "audio", "source", "track", "use", "feImage"]);
const JSX_MEDIA_ATTRS = new Set(["src", "srcSet", "href", "xlinkHref", "poster"]);
const JSX_BANNED_ATTRS = new Set(["ping", "dangerouslySetInnerHTML", "srcDoc", "action", "formAction"]);

const REMOTE = /(?:\b(?:https?|wss?|ftp):)?\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
/** XML namespaces are names, never requested. */
const NAMESPACE = /^http:\/\/www\.w3\.org\/(1998|1999|2000)\//;
const LOCAL = /^(#|\/(?!\/)|\.\.?\/|data:)/;

const text = (node) =>
  node.type === "Literal" && typeof node.value === "string"
    ? node.value
    : node.type === "TemplateLiteral" && node.expressions.length === 0
      ? node.quasis[0].value.cooked
      : null;
/** A template that opens with fixed text: `#${id}` is known to stay in the page. */
const opening = (node) => (node.type === "TemplateLiteral" ? node.quasis[0].value.cooked : text(node));
const propName = (member) => (member.computed ? text(member.property) : member.property.name);

/** A file's allowances: the exits it is the home of, and whether it may hold outbound links. */
const schema = [
  {
    type: "object",
    properties: {
      allow: { type: "array", items: { type: "string" } },
      links: { type: "boolean" },
    },
    additionalProperties: false,
  },
];

const noExit = {
  meta: { type: "problem", schema, docs: { description: "Each way out of the page lives in one named place." } },
  create(context) {
    const { allow = [], links = false } = context.options[0] ?? {};
    const allowed = (exit) => exit.home !== undefined && allow.includes(exit.home);
    const said = new Map();
    const report = (node, message) => {
      if (said.get(node) === message) return;
      said.set(node, message);
      context.report({ node, message });
    };
    const flag = (node, exit) => {
      if (!allowed(exit)) report(node, exit.message);
    };

    /** `node` evaluates to the global object, the document or the navigator: it may only be read by a fixed name. */
    function use(node, kind) {
      const p = node.parent;
      if (p.type === "MemberExpression" && p.object === node) {
        const name = propName(p);
        if (name == null)
          return report(p, `A computed property of ${kind} could be any exit: name the property ${WHY}.`);
        return member(p, kind, name);
      }
      if ((p.type === "UnaryExpression" && p.operator === "typeof") || p.type === "TSTypeQuery") return;
      if (p.type === "BinaryExpression" && ["===", "!==", "==", "!=", "in"].includes(p.operator)) return;
      report(node, `${kind} is used only by a named property, so every exit can be seen ${WHY}.`);
    }
    function member(p, kind, name) {
      if (kind === "the global object") {
        if (GLOBAL_OBJECTS.has(name)) return use(p, kind);
        if (name === "document" || name === "navigator") return use(p, name);
        if (name === "Worker") return report(p, EXITS.SharedWorker.message);
        if (Object.hasOwn(EXITS, name)) flag(p, EXITS[name]);
      } else if (kind === "document" && Object.hasOwn(DOCUMENT_EXITS, name)) flag(p, DOCUMENT_EXITS[name]);
      else if (kind === "navigator" && Object.hasOwn(NAVIGATOR_EXITS, name)) flag(p, NAVIGATOR_EXITS[name]);
    }

    /** The reader is the one worker, and its script is a file of this build. */
    function worker(id) {
      const p = id.parent;
      const url = p.type === "NewExpression" && p.callee === id ? p.arguments[0] : null;
      const file = url?.type === "NewExpression" && url.callee.name === "URL" ? url.arguments[0] : null;
      const base = file ? url.arguments[1] : null;
      const here = base?.type === "MemberExpression" && base.object.type === "MetaProperty" && base.property.name === "url"; // prettier-ignore
      if (!file || !here || !/^\.\.?\//.test(text(file) ?? "")) report(id, EXITS.SharedWorker.message);
    }

    function reference(id) {
      const name = id.name;
      if (GLOBAL_OBJECTS.has(name)) use(id, "the global object");
      else if (name === "document" || name === "navigator") use(id, name);
      else if (name === "Worker") worker(id);
      else if (Object.hasOwn(EXITS, name)) flag(id, EXITS[name]);
    }
    const watched = (name) =>
      GLOBAL_OBJECTS.has(name) || ["document", "navigator", "Worker"].includes(name) || Object.hasOwn(EXITS, name);
    /** `declare const self: …` names the real global, so it is still the global. */
    const ambient = (variable) =>
      variable.defs.every((d) => d.node.parent?.declare === true || d.node.declare === true);
    const value = (ref) => ref.isValueReference !== false || ref.isTypeReference !== true;

    function remote(node, value) {
      if (links || !REMOTE.test(value) || NAMESPACE.test(value.trim())) return;
      report(node, `Code names no host: outbound links live in src/app/links.ts or third-party.json ${WHY}.`);
    }

    return {
      Program(node) {
        const seen = new Set();
        const visit = (ref) => {
          if (seen.has(ref.identifier) || !value(ref)) return;
          seen.add(ref.identifier);
          reference(ref.identifier);
        };
        const walk = (scope) => {
          for (const v of scope.variables) if (watched(v.name) && ambient(v)) v.references.forEach(visit);
          scope.childScopes.forEach(walk);
        };
        const top = context.sourceCode.getScope(node);
        walk(top);
        for (const ref of top.through) if (watched(ref.identifier.name)) visit(ref);
      },
      MemberExpression(node) {
        const name = propName(node);
        if (name != null && Object.hasOwn(ANYWHERE, name)) {
          const root = node.object.type === "Identifier" ? node.object.name : "";
          // The named objects report their own exits above: say each thing once.
          if (!GLOBAL_OBJECTS.has(root) && root !== "document" && root !== "navigator") flag(node, ANYWHERE[name]);
        }
      },
      AssignmentExpression(node) {
        const left = node.left;
        if (left.type !== "MemberExpression") return;
        const name = propName(left);
        if (name == null || !LOADING_PROPS.has(name)) return;
        if (name === "href" && allow.includes("location")) return;
        report(left, `Setting .${name} can load or send something: nothing is loaded from script ${WHY}.`);
      },
      CallExpression(node) {
        const callee = node.callee.type === "MemberExpression" ? propName(node.callee) : null;
        const [first, second] = node.arguments;
        if ((callee === "setAttribute" || callee === "setAttributeNS") && first) {
          const name = text(callee === "setAttribute" ? first : (second ?? first));
          const set = node.arguments[callee === "setAttribute" ? 1 : 2];
          if (name != null && LOADING_ATTRS.has(name.toLowerCase()) && !(set && (opening(set) ?? "").startsWith("#")))
            report(node, `The ${name} attribute can load or send something: nothing is loaded from script ${WHY}.`);
        }
        if ((callee === "createElement" || callee === "createElementNS") && first) {
          const tag = text(callee === "createElement" ? first : (second ?? first));
          if (tag != null && LOADING_TAGS.has(tag.toLowerCase()))
            report(node, `A <${tag}> made from script can load or send something ${WHY}.`);
        }
        const called = callee ?? (node.callee.type === "Identifier" ? node.callee.name : null);
        if ((called === "setTimeout" || called === "setInterval") && first && opening(first) != null)
          report(node, `No code from strings ${WHY}.`);
        if (callee === "postMessage" && second) {
          const origin = text(second) != null || second.type === "TemplateLiteral";
          const options = second.type === "ObjectExpression" && second.properties.some((q) => q.key?.name === "targetOrigin"); // prettier-ignore
          if (origin || options) report(node, EXITS.postMessage.message);
        }
      },
      ImportExpression(node) {
        const from = text(node.source);
        if (from == null || /^(https?:|\/\/|data:|blob:)/i.test(from))
          report(node, `import() takes a fixed path inside this build ${WHY}.`);
      },
      Literal(node) {
        if (typeof node.value === "string" && node.parent.type !== "ImportDeclaration") remote(node, node.value);
      },
      TemplateElement(node) {
        remote(node, node.value.cooked ?? "");
      },
      JSXText(node) {
        remote(node, node.value);
      },
      JSXOpeningElement(node) {
        const tag = node.name.type === "JSXIdentifier" ? node.name.name : "";
        if (JSX_BANNED.has(tag)) report(node, `A <${tag}> can load or send something ${WHY}.`);
        const attrs = new Map();
        for (const a of node.attributes) {
          if (a.type !== "JSXAttribute") {
            if (tag === "a" || JSX_MEDIA.has(tag))
              report(a, `Spread props on <${tag}> could carry any attribute: write them out ${WHY}.`);
            continue;
          }
          const name =
            a.name.type === "JSXNamespacedName" ? `${a.name.namespace.name}:${a.name.name.name}` : a.name.name;
          const value = a.value?.type === "JSXExpressionContainer" ? a.value.expression : a.value;
          attrs.set(name, value ? opening(value) : "");
          if (JSX_BANNED_ATTRS.has(name)) report(a, `The ${name} attribute can load or send something ${WHY}.`);
          if (JSX_MEDIA.has(tag) && (JSX_MEDIA_ATTRS.has(name) || name === "xlink:href")) {
            const fixed = value ? opening(value) : null;
            if (fixed == null || !LOCAL.test(fixed))
              report(a, `<${tag} ${name}> takes a fixed address inside this build ${WHY}.`);
          }
        }
        if (tag !== "a") return;
        const rel = attrs.get("rel") ?? "";
        const href = attrs.get("href");
        if (typeof href === "string" && /^\s*javascript:/i.test(href)) report(node, `No code from strings ${WHY}.`);
        const leaves = attrs.has("target") || (typeof href === "string" && REMOTE.test(href));
        if (leaves && !/\bnoreferrer\b/.test(rel))
          report(node, `A link that leaves the page carries rel="noreferrer" ${WHY}.`);
      },
    };
  },
};

export default { rules: { "no-exit": noExit } };
