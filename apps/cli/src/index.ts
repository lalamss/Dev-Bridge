#!/usr/bin/env node
import { Command } from "commander";
import { startCommand } from "./commands/start";
import { statusCommand } from "./commands/status";
import { diffCommand } from "./commands/diff";
import { previewCommand } from "./commands/preview";
import { applyCommand } from "./commands/apply";
import { rollbackCommand } from "./commands/rollback";

const program = new Command();

program.name("devbridge").description("DevBridge CLI — same protocol as the DevTools panel (section 48)").version("0.1.0");

program
  .command("start [dir]")
  .description("Register a project and start the local dev agent")
  .action(startCommand);

program.command("status").description("Show project / agent status").action(statusCommand);

program.command("diff").description("Show the current git working-tree diff").action(diffCommand);

program.command("preview <patchId>").description("Preview a proposed patch").action(previewCommand);

program.command("apply <patchId>").description("Apply a previewed patch to disk").action(applyCommand);

program.command("rollback").description("Revert to the last checkpoint whose tests passed").action(rollbackCommand);

program.parseAsync(process.argv);
