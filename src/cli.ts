#!/usr/bin/env node

import { Command } from 'commander';
import { version } from '../package.json';

const program = new Command();

program
  .name('together-agent')
  .description('A TypeScript CLI SDK')
  .version(version);

program
  .command('hello')
  .description('Say hello')
  .argument('[name]', 'name to greet', 'World')
  .action((name: string) => {
    console.log(`Hello, ${name}!`);
  });

program.parse();
