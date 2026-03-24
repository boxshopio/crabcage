#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("crabcage")
  .description("An auditable sandbox for agent harnesses")
  .version("0.1.0");

program.parse();
