import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as babel from "@babel/core";
import type { FrameworkAdapter } from "@devbridge/framework-core";
import type { ComponentInfo, DevIdentity, RenderEvent, SourceLocation, StateSnapshot } from "@devbridge/protocol";
import { devIdentityBabelPlugin } from "./babelPlugin";

/**
 * ReactAdapter — see architecture doc section 21-22.
 *
 * Deliberately does NOT reach into React Fiber internals. Runtime state
 * (props/state/context, render events) is populated by a small runtime hook
 * (see runtimeHook.ts) that the app opts into in development, and is pushed
 * to the local agent over the WebSocket protocol — this adapter just holds
 * the latest snapshot per devId so the local agent's HTTP routes can serve
 * it synchronously.
 */
export class ReactAdapter implements FrameworkAdapter {
  readonly name = "react";

  private components = new Map<string, ComponentInfo>();
  private sourceLocations = new Map<string, SourceLocation>();
  private stateSnapshots = new Map<string, StateSnapshot>();
  private renderEvents: RenderEvent[] = [];

  detect(projectRoot: string): boolean {
    const pkgPath = join(projectRoot, "package.json");
    if (!existsSync(pkgPath)) return false;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      return Boolean(deps.react);
    } catch {
      return false;
    }
  }

  transformSource(args: { file: string; code: string }): { code: string; map?: unknown; identities: DevIdentity[] } {
    const identities: DevIdentity[] = [];
    const result = babel.transformSync(args.code, {
      filename: args.file,
      babelrc: false,
      configFile: false,
      presets: [
        ["@babel/preset-typescript", { isTSX: true, allExtensions: true }],
      ],
      plugins: [() => devIdentityBabelPlugin({ file: args.file, identities })],
      sourceMaps: true,
      retainLines: true,
    });

    for (const identity of identities) {
      this.sourceLocations.set(identity.id, identity.source);
      this.components.set(identity.id, {
        devId: identity.id,
        name: identity.component ?? identity.id,
        children: identities.filter((i) => i.parentId === identity.id).map((i) => i.id),
      });
    }

    return { code: result?.code ?? args.code, map: result?.map, identities };
  }

  getComponent(devId: string): ComponentInfo | undefined {
    return this.components.get(devId);
  }

  getSourceLocation(devId: string): SourceLocation | undefined {
    return this.sourceLocations.get(devId);
  }

  getRuntimeState(devId: string): StateSnapshot | undefined {
    return this.stateSnapshots.get(devId);
  }

  getRenderEvents(devId?: string): RenderEvent[] {
    return devId ? this.renderEvents.filter((e) => e.devId === devId) : this.renderEvents;
  }

  /** Called by the local agent when a runtime event arrives over the WS bridge. */
  ingestStateSnapshot(snapshot: StateSnapshot): void {
    this.stateSnapshots.set(snapshot.devId, snapshot);
  }

  ingestRenderEvent(event: RenderEvent): void {
    this.renderEvents.push(event);
    if (this.renderEvents.length > 5000) this.renderEvents.shift();
  }
}
