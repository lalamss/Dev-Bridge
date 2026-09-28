import type { DevIdentity } from "@devbridge/protocol";

/**
 * DevIdentityRegistry — in-memory index over every DevIdentity the build
 * plugin has emitted for the current project (section 6).
 *
 * The local agent owns one instance of this. It is rebuilt whenever the
 * build plugin re-emits identity metadata (on file save / HMR).
 */
export class DevIdentityRegistry {
  private byId = new Map<string, DevIdentity>();
  private byFile = new Map<string, Set<string>>();

  upsert(identity: DevIdentity): void {
    this.byId.set(identity.id, identity);
    const set = this.byFile.get(identity.source.file) ?? new Set<string>();
    set.add(identity.id);
    this.byFile.set(identity.source.file, set);
  }

  upsertMany(identities: DevIdentity[]): void {
    for (const identity of identities) this.upsert(identity);
  }

  get(id: string): DevIdentity | undefined {
    return this.byId.get(id);
  }

  children(id: string): DevIdentity[] {
    return [...this.byId.values()].filter((d) => d.parentId === id);
  }

  forFile(file: string): DevIdentity[] {
    const ids = this.byFile.get(file);
    if (!ids) return [];
    return [...ids].map((id) => this.byId.get(id)!).filter(Boolean);
  }

  /**
   * Called after a patch shifts lines within a file (section 33: identity
   * survives line-number drift). We re-map every identity in the file whose
   * start line is at/after `fromLine` by `delta` lines.
   */
  remapAfterEdit(file: string, fromLine: number, delta: number): void {
    for (const id of this.byFile.get(file) ?? []) {
      const identity = this.byId.get(id);
      if (!identity) continue;
      if (identity.source.start.line >= fromLine) {
        identity.source.start.line += delta;
        identity.source.end.line += delta;
      }
    }
  }

  all(): DevIdentity[] {
    return [...this.byId.values()];
  }

  clearFile(file: string): void {
    for (const id of this.byFile.get(file) ?? []) this.byId.delete(id);
    this.byFile.delete(file);
  }
}
