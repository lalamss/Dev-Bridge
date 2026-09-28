import simpleGit, { type SimpleGit } from "simple-git";
import type { GitCheckpoint } from "@devbridge/protocol";

/**
 * GitManager — architecture doc section 40:
 *
 *   Commit A (tests pass) -> Commit B (tests pass) -> Commit C (tests pass)
 *   -> Patch D (tests fail) -> "Last Green" = Commit C -> [Rollback to Last Green]
 *
 * Rollback is implemented as a normal `git revert`/checkout-based operation,
 * never a forced reset, so it stays reversible and never silently destroys
 * work (section 40: "This should create a reversible Git operation rather
 * than silently destroying work.").
 */
export class GitManager {
  private git: SimpleGit;
  private checkpoints: GitCheckpoint[] = [];

  constructor(private projectRoot: string) {
    this.git = simpleGit(projectRoot);
  }

  async isClean(): Promise<boolean> {
    const status = await this.git.status();
    return status.isClean();
  }

  async currentSha(): Promise<string> {
    return (await this.git.revparse(["HEAD"])).trim();
  }

  async diff(): Promise<string> {
    return this.git.diff();
  }

  /** Create a DevBridge checkpoint commit after a patch is applied + tests run. */
  async checkpoint(message: string, testsPassing: boolean | null): Promise<GitCheckpoint> {
    await this.git.add(["-A"]);
    const commit = await this.git.commit(`[devbridge] ${message}`);
    const cp: GitCheckpoint = {
      sha: commit.commit,
      message,
      createdBy: "devbridge",
      timestamp: new Date().toISOString(),
      testsPassing,
    };
    this.checkpoints.push(cp);
    return cp;
  }

  lastGreen(): GitCheckpoint | undefined {
    return [...this.checkpoints].reverse().find((c) => c.testsPassing === true);
  }

  listCheckpoints(): GitCheckpoint[] {
    return [...this.checkpoints];
  }

  /**
   * Reversible rollback: creates a new commit that reverts the range between
   * the last-green checkpoint and HEAD, rather than a destructive reset.
   */
  async rollbackTo(sha: string): Promise<GitCheckpoint> {
    const head = await this.currentSha();
    if (head === sha) throw new Error("Already at target checkpoint.");
    await this.git.raw(["revert", "--no-commit", `${sha}..${head}`]);
    const commit = await this.git.commit(`[devbridge] rollback to ${sha.slice(0, 7)}`);
    const cp: GitCheckpoint = {
      sha: commit.commit,
      message: `rollback to ${sha.slice(0, 7)}`,
      createdBy: "devbridge",
      timestamp: new Date().toISOString(),
      testsPassing: null,
    };
    this.checkpoints.push(cp);
    return cp;
  }
}
