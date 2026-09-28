import type {
  ComponentInfo,
  DevIdentity,
  RenderEvent,
  SourceLocation,
  StateSnapshot,
} from "@devbridge/protocol";

/**
 * Every framework (React, Vue, Svelte, Angular, ...) plugs into DevBridge by
 * implementing this interface. The core (dev-identity, patch-engine,
 * local-agent) never imports a framework-specific package directly — see
 * architecture doc section 5: "Don't make the core understand every
 * framework."
 */
export interface FrameworkAdapter {
  readonly name: string;

  /** Detect whether this adapter applies to the given project root. */
  detect(projectRoot: string): boolean | Promise<boolean>;

  /** Transform source during build to inject Dev Identity metadata. */
  transformSource(args: { file: string; code: string }): {
    code: string;
    map?: unknown;
    identities: DevIdentity[];
  };

  /** Resolve the ComponentInfo for a DOM element carrying a data-dev-id. */
  getComponent(devId: string): ComponentInfo | undefined;

  /** Resolve the current source location for a DevIdentity (post any edits). */
  getSourceLocation(devId: string): SourceLocation | undefined;

  /** Best-effort props/state/context snapshot for a running instance. */
  getRuntimeState(devId: string): StateSnapshot | undefined;

  /** Recent render events, most-recent-last. */
  getRenderEvents(devId?: string): RenderEvent[];
}
