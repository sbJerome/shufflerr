/* eslint-disable no-console */
// Generates shufflerr-api.yml (OpenAPI 3.0) from the code so the spec cannot
// drift from what is mounted:
//
//   1. Every route is collected at runtime: the Router is patched before
//      server/routes is imported, so each `router.get('/x', …)` and each
//      `router.use('/mount', child)` is recorded with the file and line that
//      declared it.
//   2. The TypeScript checker reads the same call sites and turns the
//      `router.get<Params, ResBody, ReqBody>` type arguments into JSON Schema
//      (named types become components). Query parameters and the permission
//      are read from the handler source; the comment above a route becomes its
//      description.
//
// Run: ts-node -r tsconfig-paths/register --files --project server/tsconfig.json server/scripts/generateApiSpec.ts
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

(process.env as Record<string, string | undefined>).NODE_ENV ??= 'test';

const ROOT = path.join(__dirname, '../..');
const OUT = path.join(ROOT, 'shufflerr-api.yml');
const METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const;
type Method = (typeof METHODS)[number];

// ---------------------------------------------------------------------------
// 1. Runtime collection
// ---------------------------------------------------------------------------

interface Site {
  file: string;
  line: number;
}
interface RecordedRoute {
  paths: string[];
  route: { methods: Record<string, boolean> };
  site: Site;
}
interface RecordedMount {
  paths: string[];
  child: object;
}

const routesOf = new WeakMap<object, RecordedRoute[]>();
const mountsOf = new WeakMap<object, RecordedMount[]>();

const callSite = (): Site => {
  const stack = (new Error().stack ?? '').split('\n').slice(2);
  for (const frame of stack) {
    const match = frame.match(/\(?((?:\/|[A-Za-z]:\\)[^():]+):(\d+):\d+\)?$/);
    if (!match) {
      continue;
    }
    const file = match[1];
    if (
      file.includes('node_modules') ||
      file.endsWith('generateApiSpec.ts') ||
      !file.includes(`${path.sep}server${path.sep}`)
    ) {
      continue;
    }
    return { file, line: Number(match[2]) };
  }
  return { file: '', line: 0 };
};

const asPaths = (value: unknown): string[] | null => {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return value as string[];
  }
  return null;
};

const patchRouter = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express');
  const proto = express.Router.prototype;
  const originalRoute = proto.route;
  const originalUse = proto.use;

  proto.route = function patchedRoute(this: object, routePath: unknown) {
    const route = originalRoute.call(this, routePath);
    const paths = asPaths(routePath);
    if (paths) {
      const list = routesOf.get(this) ?? [];
      list.push({ paths, route, site: callSite() });
      routesOf.set(this, list);
    }
    return route;
  };

  proto.use = function patchedUse(this: object, ...args: unknown[]) {
    const paths = asPaths(args[0]);
    const handlers = (paths ? args.slice(1) : args).flat();
    for (const handler of handlers) {
      if (typeof handler === 'function' && 'stack' in handler) {
        const list = mountsOf.get(this) ?? [];
        list.push({ paths: paths ?? [''], child: handler });
        mountsOf.set(this, list);
      }
    }
    return originalUse.apply(this, args);
  };
};

interface FlatRoute {
  method: Method;
  path: string;
  site: Site;
}

const joinPath = (base: string, part: string): string =>
  `${base}/${part}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

const flatten = (
  router: object,
  base: string,
  out: FlatRoute[],
  seen = new Set<object>()
): void => {
  if (seen.has(router)) {
    return;
  }
  seen.add(router);
  for (const recorded of routesOf.get(router) ?? []) {
    for (const p of recorded.paths) {
      for (const method of METHODS) {
        if (recorded.route.methods[method]) {
          out.push({ method, path: joinPath(base, p), site: recorded.site });
        }
      }
    }
  }
  for (const mount of mountsOf.get(router) ?? []) {
    for (const p of mount.paths) {
      flatten(mount.child, joinPath(base, p), out, new Set(seen));
    }
  }
};

// ---------------------------------------------------------------------------
// 2. Static typing
// ---------------------------------------------------------------------------

type Schema = Record<string, unknown>;

interface StaticInfo {
  typeArgs: ts.TypeNode[];
  text: string;
  comment: string;
  node: ts.CallExpression;
}

const components: Record<string, Schema> = {};
const building = new Set<string>();

const buildProgram = (): ts.Program => {
  const configPath = path.join(ROOT, 'server/tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configPath)
  );
  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: { ...parsed.options, noEmit: true },
  });
};

const leadingComment = (source: ts.SourceFile, node: ts.Node): string => {
  // the statement that holds the call carries the comment block
  let statement: ts.Node = node;
  while (statement.parent && !ts.isSourceFile(statement.parent)) {
    if (ts.isExpressionStatement(statement)) {
      break;
    }
    statement = statement.parent;
  }
  const ranges =
    ts.getLeadingCommentRanges(source.text, statement.getFullStart()) ?? [];
  return ranges
    .map((range) => source.text.slice(range.pos, range.end))
    .join('\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*\/\*\*?/, '')
        .replace(/\*\/\s*$/, '')
        .replace(/^\s*(\/\/|\*)\s?/, '')
        .trimEnd()
    )
    .filter((line) => !/^Adapted from Seerr|^Original:|eslint-/.test(line))
    .join('\n')
    .trim();
};

const collectStatic = (
  program: ts.Program,
  files: Set<string>
): Map<string, StaticInfo> => {
  const found = new Map<string, StaticInfo>();
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) {
      continue;
    }
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (METHODS as readonly string[]).includes(node.expression.name.text)
      ) {
        const info: StaticInfo = {
          typeArgs: [...(node.typeArguments ?? [])],
          text: node.getText(source),
          comment: leadingComment(source, node),
          node,
        };
        // V8 reports the position of the method name; multi-line generics can
        // push the opening parenthesis further down, so index a few anchors.
        const lines = new Set<number>();
        for (const pos of [
          node.expression.name.getStart(source),
          node.expression.getStart(source),
          node.arguments.pos,
        ]) {
          lines.add(source.getLineAndCharacterOfPosition(pos).line + 1);
        }
        for (const line of lines) {
          const key = `${file}:${line}`;
          if (!found.has(key)) {
            found.set(key, info);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
};

const NAMELESS = new Set(['__type', '__object', 'Object', 'Record', 'Partial']);

const componentName = (type: ts.Type): string | null => {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const name = symbol?.getName();
  if (!name || NAMELESS.has(name) || name.startsWith('__')) {
    return null;
  }
  // generic instantiations (Partial<User>, Pick<…>) are inlined
  if (type.aliasTypeArguments?.length) {
    return null;
  }
  const declaration = symbol?.declarations?.[0];
  if (!declaration || declaration.getSourceFile().isDeclarationFile) {
    return null;
  }
  return name;
};

const typeToSchema = (
  checker: ts.TypeChecker,
  type: ts.Type,
  depth = 0
): Schema => {
  const flags = type.flags;

  if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    return {};
  }
  if (flags & (ts.TypeFlags.Never | ts.TypeFlags.Void)) {
    return {};
  }
  if (flags & ts.TypeFlags.StringLiteral) {
    return { type: 'string', enum: [(type as ts.StringLiteralType).value] };
  }
  if (flags & ts.TypeFlags.NumberLiteral) {
    return { type: 'number', enum: [(type as ts.NumberLiteralType).value] };
  }
  if (flags & ts.TypeFlags.BooleanLike) {
    return { type: 'boolean' };
  }
  if (flags & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral)) {
    return { type: 'string' };
  }
  if (flags & (ts.TypeFlags.Number | ts.TypeFlags.BigInt)) {
    return { type: 'number' };
  }
  if (flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) {
    return { nullable: true };
  }

  if (type.isUnion()) {
    const members = type.types.filter(
      (t) => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void))
    );
    const nullable = members.some((t) => t.flags & ts.TypeFlags.Null);
    const rest = members.filter((t) => !(t.flags & ts.TypeFlags.Null));
    let schema: Schema;

    if (rest.length === 0) {
      schema = {};
    } else if (rest.every((t) => t.flags & ts.TypeFlags.BooleanLike)) {
      schema = { type: 'boolean' };
    } else if (rest.every((t) => t.flags & ts.TypeFlags.StringLiteral)) {
      schema = {
        type: 'string',
        enum: rest.map((t) => (t as ts.StringLiteralType).value),
      };
    } else if (rest.every((t) => t.flags & ts.TypeFlags.NumberLiteral)) {
      schema = {
        type: 'number',
        enum: rest.map((t) => (t as ts.NumberLiteralType).value),
      };
    } else if (rest.length === 1) {
      schema = typeToSchema(checker, rest[0], depth);
    } else {
      // collapse true|false pairs that sit next to other members
      const seenBoolean = { done: false };
      const variants: Schema[] = [];
      for (const member of rest) {
        if (member.flags & ts.TypeFlags.BooleanLike) {
          if (!seenBoolean.done) {
            variants.push({ type: 'boolean' });
            seenBoolean.done = true;
          }
          continue;
        }
        variants.push(typeToSchema(checker, member, depth));
      }
      schema = variants.length === 1 ? variants[0] : { oneOf: variants };
    }

    if (nullable) {
      // OpenAPI 3.0: `nullable` may not sit next to a bare $ref
      return schema.$ref
        ? { allOf: [schema], nullable: true }
        : { ...schema, nullable: true };
    }
    return schema;
  }

  if (type.isIntersection()) {
    return objectSchema(checker, type, depth);
  }

  const symbolName = type.getSymbol()?.getName();
  if (symbolName === 'Date') {
    return { type: 'string', format: 'date-time' };
  }
  if (symbolName === 'Buffer' || symbolName === 'Uint8Array') {
    return { type: 'string', format: 'binary' };
  }
  if (symbolName === 'Promise') {
    const [inner] = checker.getTypeArguments(type as ts.TypeReference);
    return inner ? typeToSchema(checker, inner, depth) : {};
  }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const [item] = checker.getTypeArguments(type as ts.TypeReference);
    return {
      type: 'array',
      items: item ? typeToSchema(checker, item, depth + 1) : {},
    };
  }
  if (type.getCallSignatures().length > 0) {
    return {};
  }

  if (flags & ts.TypeFlags.Object || flags & ts.TypeFlags.TypeParameter) {
    const name = componentName(type);
    if (name) {
      if (!components[name] && !building.has(name)) {
        building.add(name);
        components[name] = objectSchema(checker, type, 0);
        building.delete(name);
      }
      return { $ref: `#/components/schemas/${name}` };
    }
    return objectSchema(checker, type, depth);
  }

  return {};
};

const objectSchema = (
  checker: ts.TypeChecker,
  type: ts.Type,
  depth: number
): Schema => {
  if (depth > 6) {
    return { type: 'object' };
  }
  const properties: Record<string, Schema> = {};
  const required: string[] = [];

  for (const property of checker.getPropertiesOfType(type)) {
    const name = property.getName();
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (name.startsWith('_') || name.startsWith('#') || !declaration) {
      continue;
    }
    if (
      ts.isMethodDeclaration(declaration) ||
      ts.isMethodSignature(declaration) ||
      (ts.isGetAccessorDeclaration(declaration) === false &&
        ts.isSetAccessorDeclaration(declaration))
    ) {
      continue;
    }
    const modifiers = ts.getCombinedModifierFlags(declaration);
    if (
      modifiers & ts.ModifierFlags.Private ||
      modifiers & ts.ModifierFlags.Protected ||
      modifiers & ts.ModifierFlags.Static
    ) {
      continue;
    }
    const propertyType = checker.getTypeOfSymbolAtLocation(
      property,
      declaration
    );
    if (propertyType.getCallSignatures().length > 0) {
      continue;
    }
    // never expose secrets the entities carry but the API strips
    if (
      /^(password|resetPasswordGuid|plexToken|jellyfinAuthToken|hash|encryptedSecret|secret)$/.test(
        name
      )
    ) {
      continue;
    }
    const schema = typeToSchema(checker, propertyType, depth + 1);
    const docs = ts.displayPartsToString(
      property.getDocumentationComment(checker)
    );
    properties[name] =
      docs && !schema.$ref ? { ...schema, description: docs } : schema;
    if (!(property.flags & ts.SymbolFlags.Optional)) {
      required.push(name);
    }
  }

  const index =
    checker.getIndexInfoOfType(type, ts.IndexKind.String) ??
    checker.getIndexInfoOfType(type, ts.IndexKind.Number);
  const schema: Schema = { type: 'object' };

  if (Object.keys(properties).length > 0) {
    schema.properties = properties;
  }
  if (required.length > 0) {
    schema.required = required;
  }
  if (index) {
    schema.additionalProperties = typeToSchema(checker, index.type, depth + 1);
  }
  return schema;
};

const isEmptyType = (type: ts.Type): boolean =>
  !!(
    type.flags &
    (ts.TypeFlags.Never |
      ts.TypeFlags.Any |
      ts.TypeFlags.Unknown |
      ts.TypeFlags.Void |
      ts.TypeFlags.Undefined)
  );

/**
 * OpenAPI 3.0 only allows `nullable` next to a `type`. Nullable references
 * become a typed allOf; other untyped nullables say so in their description.
 */
const fixNullable = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(fixNullable);
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const schema = value as Schema;
  if (schema.nullable === true && schema.type === undefined) {
    if (Array.isArray(schema.allOf)) {
      schema.type = 'object';
    } else {
      delete schema.nullable;
      const note = 'May be null.';
      schema.description = schema.description
        ? `${schema.description} ${note}`
        : note;
    }
  }
  Object.values(schema).forEach(fixNullable);
};

/** Properties that mark an error payload rather than a result. */
const ERROR_KEYS = new Set(['message', 'status', 'error', 'errors']);

/**
 * When a route has no `<Params, ResBody, ReqBody>` type arguments, read the
 * types from the handler itself: what it passes to `res.json(…)` and what it
 * casts `req.body` to.
 */
const inferFromHandler = (
  checker: ts.TypeChecker,
  call: ts.CallExpression
): { response: ts.Type | null; request: ts.Type | null } => {
  const responses: ts.Type[] = [];
  let request: ts.Type | null = null;

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'json' &&
      node.arguments.length === 1
    ) {
      const type = checker.getTypeAtLocation(node.arguments[0]);
      const names = checker.getPropertiesOfType(type).map((p) => p.getName());
      const looksLikeError =
        names.length > 0 && names.every((name) => ERROR_KEYS.has(name));
      if (!looksLikeError && !isEmptyType(type)) {
        responses.push(type);
      }
    }
    if (
      !request &&
      ts.isAsExpression(node) &&
      node.expression.getText() === 'req.body' &&
      node.type.kind !== ts.SyntaxKind.UnknownKeyword &&
      node.type.kind !== ts.SyntaxKind.AnyKeyword
    ) {
      const type = checker.getTypeFromTypeNode(node.type);
      if (!isEmptyType(type)) {
        request = type;
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const argument of call.arguments) {
    visit(argument);
  }

  // the success payload is normally the last thing a handler sends
  return { response: responses[responses.length - 1] ?? null, request };
};

// ---------------------------------------------------------------------------
// 3. Assembly
// ---------------------------------------------------------------------------

const TAGS: [RegExp, string, string][] = [
  [/^\/status/, 'Status', 'Server status and public settings'],
  [/^\/public/, 'Public', 'Routes that need no sign-in'],
  [/^\/auth/, 'Auth', 'Sign-in, sign-out and first-run setup'],
  [/^\/callback/, 'Auth', ''],
  [
    /^\/user\/:[^/]+\/settings/,
    'User settings',
    'Per-user settings, linked accounts and app passwords',
  ],
  [/^\/user/, 'Users', 'User list, profiles and quotas'],
  [/^\/search/, 'Search', 'MusicBrainz search with library status'],
  [/^\/discover/, 'Discover', 'Discover page rows'],
  [/^\/library/, 'Library', 'Albums and artists in the library'],
  [/^\/artist/, 'Artists', 'Artist pages'],
  [/^\/album/, 'Albums', 'Album (release group) pages'],
  [/^\/recording/, 'Tracks', 'Recordings'],
  [/^\/request/, 'Requests', 'Request engine and approvals'],
  [/^\/media/, 'Media', 'Library index rows'],
  [/^\/service/, 'Services', 'Lidarr servers for the request modal'],
  [/^\/stream/, 'Playback', 'Audio streaming and waveforms'],
  [/^\/scrobble/, 'Playback', ''],
  [/^\/youtube/, 'Playback', ''],
  [/^\/webhooks/, 'Webhooks', 'Play events from Plex and Jellyfin'],
  [/^\/import/, 'Import', 'Import from Spotify, Deezer and Apple Music links'],
  [/^\/issue/, 'Issues', 'Problem reports'],
  [/^\/blocklist/, 'Blocklist', 'Blocked artists and albums'],
  [/^\/watchlist/, 'Watchlist', 'Per-user wanted list'],
  [/^\/overrideRule/, 'Override rules', 'Routing rules for requests'],
  [
    /^\/settings\/notifications/,
    'Settings: notifications',
    'Notification agents',
  ],
  [
    /^\/settings\/(plex|jellyfin|navidrome|local)/,
    'Settings: stream from',
    'Library sources',
  ],
  [/^\/settings\/lidarr/, 'Settings: Lidarr', 'Lidarr servers'],
  [
    /^\/settings\/(jobs|cache|logs|about)/,
    'Settings: system',
    'Jobs, cache, logs and about',
  ],
  [/^\/settings/, 'Settings', 'Server settings'],
];

const tagFor = (apiPath: string): string =>
  TAGS.find(([pattern]) => pattern.test(apiPath))?.[1] ?? 'Other';

const PERMISSION = /isAuthenticated\(\s*([^)]*?)\s*(?:,\s*\{[^}]*\})?\s*\)/s;

const permissionText = (text: string): string | null => {
  const match = text.match(PERMISSION);
  if (!match) {
    return null;
  }
  const names = [...match[1].matchAll(/Permission\.([A-Z_]+)/g)].map(
    (m) => m[1]
  );
  if (names.length === 0) {
    return null;
  }
  const any = /type:\s*'or'/.test(match[0]);
  return names.length === 1 ? names[0] : names.join(any ? ' or ' : ' and ');
};

const queryParams = (text: string): string[] => {
  const names = new Set<string>();
  for (const match of text.matchAll(/req\.query\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    names.add(match[1]);
  }
  for (const match of text.matchAll(/req\.query\[['"]([^'"]+)['"]\]/g)) {
    names.add(match[1]);
  }
  for (const match of text.matchAll(
    /const\s*\{([^}]+)\}\s*=\s*req\.query\b/g
  )) {
    for (const part of match[1].split(',')) {
      const name = part.split(/[:=]/)[0].trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
};

const operationId = (method: string, apiPath: string): string =>
  method +
  apiPath
    .split('/')
    .filter(Boolean)
    .map((part) =>
      part.startsWith(':')
        ? `By${part[1].toUpperCase()}${part.slice(2)}`
        : part
            .split(/[^A-Za-z0-9]+/)
            .filter(Boolean)
            .map((word) => word[0].toUpperCase() + word.slice(1))
            .join('')
    )
    .join('');

const ERROR_REF = { $ref: '#/components/schemas/Error' };
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ERROR_REF } },
});

const BINARY: [RegExp, string, string][] = [
  [
    /^\/stream\/track\/:[^/]+$/,
    'audio/*',
    'Audio bytes (supports Range requests)',
  ],
];

const main = async (): Promise<void> => {
  patchRouter();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rootRouter = require('@server/routes').default as object;
  const flat: FlatRoute[] = [];
  flatten(rootRouter, '', flat);

  const program = buildProgram();
  const checker = program.getTypeChecker();
  const statics = collectStatic(
    program,
    new Set(flat.map((route) => route.site.file).filter(Boolean))
  );

  const paths: Record<string, Record<string, unknown>> = {};
  const usedTags = new Set<string>();
  const usedIds = new Set<string>();
  let typed = 0;

  flat.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      METHODS.indexOf(a.method) - METHODS.indexOf(b.method)
  );

  for (const route of flat) {
    const openApiPath = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}') || '/';
    const item = (paths[openApiPath] ??= {});
    if (item[route.method]) {
      continue;
    }
    const info = statics.get(`${route.site.file}:${route.site.line}`);
    const tag = tagFor(route.path);
    usedTags.add(tag);

    const parameters: Record<string, unknown>[] = [
      ...[...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => ({
        name: match[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })),
      ...(info ? queryParams(info.text) : []).map((name) => ({
        name,
        in: 'query',
        required: false,
        schema: { type: 'string' },
      })),
    ];

    let responseSchema: Schema | null = null;
    let requestSchema: Schema | null = null;
    if (info) {
      const [, resBody, reqBody] = info.typeArgs;
      if (resBody) {
        const type = checker.getTypeFromTypeNode(resBody);
        if (!isEmptyType(type)) {
          responseSchema = typeToSchema(checker, type);
        }
      }
      if (reqBody && route.method !== 'get') {
        const type = checker.getTypeFromTypeNode(reqBody);
        if (!isEmptyType(type)) {
          requestSchema = typeToSchema(checker, type);
        }
      }
      if (!responseSchema || (!requestSchema && route.method !== 'get')) {
        const inferred = inferFromHandler(checker, info.node);
        if (!responseSchema && inferred.response) {
          responseSchema = typeToSchema(checker, inferred.response);
        }
        if (!requestSchema && inferred.request && route.method !== 'get') {
          requestSchema = typeToSchema(checker, inferred.request);
        }
      }
      if (
        (responseSchema && Object.keys(responseSchema).length > 0) ||
        requestSchema
      ) {
        typed++;
      }
    }

    const permission = info ? permissionText(info.text) : null;
    const isPublic =
      /^\/(public|status|auth\/(plex|jellyfin|local|setup|setup-local|reset-password)|callback|webhooks)/.test(
        route.path
      ) || route.path === '/settings/public';
    const commentLines = (info?.comment ?? '').split('\n').filter(Boolean);
    const summarySource =
      commentLines.find(
        (line) =>
          !/^(GET|POST|PUT|DELETE|PATCH)\s/.test(line) &&
          !/^(in|out):/.test(line.trim())
      ) ?? '';
    const summary = (
      summarySource.replace(/\s+/g, ' ').trim() ||
      `${route.method.toUpperCase()} ${route.path}`
    ).slice(0, 120);
    const description = [
      commentLines.join('\n'),
      isPublic
        ? 'No sign-in needed.'
        : permission
          ? `Requires permission: ${permission}.`
          : 'Requires a signed-in user.',
    ]
      .filter(Boolean)
      .join('\n\n');

    let id = operationId(route.method, route.path);
    while (usedIds.has(id)) {
      id += '_';
    }
    usedIds.add(id);

    const binary = BINARY.find(([pattern]) => pattern.test(route.path));
    const success: Record<string, unknown> = binary
      ? {
          description: binary[2],
          content: {
            [binary[1]]: { schema: { type: 'string', format: 'binary' } },
          },
        }
      : responseSchema
        ? {
            description: 'OK',
            content: { 'application/json': { schema: responseSchema } },
          }
        : { description: 'OK' };

    item[route.method] = {
      tags: [tag],
      summary,
      description,
      operationId: id,
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(requestSchema
        ? {
            requestBody: {
              required: false,
              content: { 'application/json': { schema: requestSchema } },
            },
          }
        : {}),
      ...(isPublic ? { security: [] } : {}),
      responses: {
        '200': success,
        ...(isPublic
          ? {}
          : {
              '401': errorResponse('Not signed in'),
              '403': errorResponse('Signed in, but not allowed'),
            }),
        default: errorResponse('Error with a message that says what to fix'),
      },
    };
  }

  const version = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')
  ).version;

  const document = {
    openapi: '3.0.3',
    info: {
      title: 'Shufflerr API',
      version,
      description: [
        'The Shufflerr REST API. Everything the web app does goes through these routes.',
        '',
        'Sign in through `/auth/*` to get a session cookie (`connect.sid`), or send the API key',
        'from Settings → General in the `X-Api-Key` header (acts as the owner).',
        '',
        'Errors are JSON `{ "message": "…" }`; the message says what happened and how to fix it.',
        '',
        'Music apps use two other surfaces that are not part of this document: OpenSubsonic at',
        '`/rest` and a Jellyfin-compatible API at `/jellyfin`, both signed in with app passwords.',
        '',
        'This file is generated from the code by `server/scripts/generateApiSpec.ts`; edit the',
        'routes and interfaces, then regenerate.',
      ].join('\n'),
      license: { name: 'MIT' },
    },
    servers: [{ url: '/api/v1' }],
    tags: [...new Map(TAGS.map(([, name, text]) => [name, text]))]
      .filter(([name]) => usedTags.has(name))
      .map(([name]) => ({
        name,
        description:
          TAGS.find(([, n, text]) => n === name && text)?.[2] ?? name,
      })),
    security: [{ cookieAuth: [] }, { apiKey: [] }],
    paths,
    components: {
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'connect.sid' },
        apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
        ...Object.fromEntries(
          Object.entries(components).sort(([a], [b]) => a.localeCompare(b))
        ),
      },
    },
  };

  fixNullable(document);

  const header = [
    '# Shufflerr API — OpenAPI 3.0',
    '# GENERATED by server/scripts/generateApiSpec.ts from the mounted routes and their',
    '# TypeScript types. Do not edit by hand; regenerate after changing a route.',
    '',
  ].join('\n');
  fs.writeFileSync(
    OUT,
    header + yaml.dump(document, { lineWidth: 110, noRefs: true })
  );

  const operations = Object.values(paths).reduce(
    (sum, item) => sum + Object.keys(item).length,
    0
  );
  console.log(
    `Wrote ${path.relative(ROOT, OUT)}: ${Object.keys(paths).length} paths, ${operations} operations, ` +
      `${typed} with typed bodies, ${Object.keys(components).length} schemas, ` +
      `${flat.filter((r) => !statics.get(`${r.site.file}:${r.site.line}`)).length} without a static match`
  );
};

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
