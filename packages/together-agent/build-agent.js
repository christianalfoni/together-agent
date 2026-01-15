const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

async function build() {
  try {
    await esbuild.build({
      entryPoints: ['src/agent/index.ts'],
      bundle: true,
      platform: 'node',
      target: 'node18',
      outfile: 'dist/agent/index.js',
      format: 'cjs',
      sourcemap: true,
      external: ['@babel/core', '@babel/plugin-transform-react-jsx'], // Don't bundle Babel
      minify: false,
      banner: {
        js: '#!/usr/bin/env node'
      }
    });

    // Copy package.json to dist/agent
    fs.copyFileSync(
      'src/agent/package.json',
      'dist/agent/package.json'
    );

    console.log('✓ Agent bundled successfully to dist/agent/');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
