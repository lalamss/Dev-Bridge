import type { NodePath, PluginObj } from "@babel/core";
import * as t from "@babel/types";
import { generateDevId } from "@devbridge/dev-identity";
import type { DevIdentity } from "@devbridge/protocol";

/**
 * devIdentityBabelPlugin — the core of "Layer 1: Build Intelligence"
 * (architecture doc section 4).
 *
 * For every JSX element in a React source file, this plugin:
 *   1. Computes a stable dvi_* id from (file, line, column, enclosing
 *      component name) — see dev-identity/generateId.ts.
 *   2. Injects `data-dev-id="dvi_..."` as a DOM attribute so the content
 *      script can read it straight off the element (section 6).
 *   3. Emits a DevIdentity record with source location + parent linkage into
 *      the `out.identities` array the caller passed in, which the Vite
 *      plugin then ships to the local agent's registry.
 *
 * We only tag host elements (lowercase tag names, e.g. <div>, <button>) by
 * default, not custom components, so we don't pollute the DOM of
 * component instances that don't render an actual element themselves.
 */
export function devIdentityBabelPlugin(args: { file: string; identities: DevIdentity[] }): PluginObj {
  const { file, identities } = args;
  const parentStack: string[] = [];
  let currentComponentName: string | null = null;
  const componentStack: string[] = [];

  function isHostElement(name: string): boolean {
    return /^[a-z]/.test(name);
  }

  return {
    name: "devbridge-dev-identity",
    visitor: {
      FunctionDeclaration: {
        enter(path: NodePath<t.FunctionDeclaration>) {
          const name = path.node.id?.name;
          if (name && /^[A-Z]/.test(name)) {
            componentStack.push(name);
            currentComponentName = name;
          }
        },
        exit(path: NodePath<t.FunctionDeclaration>) {
          const name = path.node.id?.name;
          if (name && /^[A-Z]/.test(name)) {
            componentStack.pop();
            currentComponentName = componentStack[componentStack.length - 1] ?? null;
          }
        },
      },
      VariableDeclarator: {
        enter(path: NodePath<t.VariableDeclarator>) {
          if (
            t.isIdentifier(path.node.id) &&
            /^[A-Z]/.test(path.node.id.name) &&
            (t.isArrowFunctionExpression(path.node.init) || t.isFunctionExpression(path.node.init))
          ) {
            componentStack.push(path.node.id.name);
            currentComponentName = path.node.id.name;
          }
        },
        exit(path: NodePath<t.VariableDeclarator>) {
          if (
            t.isIdentifier(path.node.id) &&
            componentStack[componentStack.length - 1] === path.node.id.name
          ) {
            componentStack.pop();
            currentComponentName = componentStack[componentStack.length - 1] ?? null;
          }
        },
      },
      JSXOpeningElement(path: NodePath<t.JSXOpeningElement>) {
        const nameNode = path.node.name;
        if (!t.isJSXIdentifier(nameNode)) return;
        if (!isHostElement(nameNode.name)) return;

        const loc = path.node.loc;
        if (!loc) return;

        const parentId = parentStack[parentStack.length - 1] ?? null;
        const devId = generateDevId(file, loc.start.line, loc.start.column, currentComponentName);

        // Avoid duplicate attribute if this file is transformed twice.
        const already = path.node.attributes.some(
          (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === "data-dev-id",
        );
        if (!already) {
          path.node.attributes.push(
            t.jsxAttribute(t.jsxIdentifier("data-dev-id"), t.stringLiteral(devId)),
          );
        }

        identities.push({
          id: devId,
          framework: "react",
          component: currentComponentName,
          source: {
            file,
            start: { line: loc.start.line, column: loc.start.column },
            end: { line: loc.end.line, column: loc.end.column },
          },
          parentId,
        });

        parentStack.push(devId);
      },
      JSXElement: {
        exit(path: NodePath<t.JSXElement>) {
          const nameNode = path.node.openingElement.name;
          if (t.isJSXIdentifier(nameNode) && isHostElement(nameNode.name)) {
            parentStack.pop();
          }
        },
      },
    },
  };
}
