import { validateWidgetCode } from './src/agent/tools/validate_widget.ts';

const code = `
  function Widget({ state, setState }) {
    return <div><span>Test</span></div>;
  }
  Widget.initialState = {};
`;

const result = validateWidgetCode(code);
console.log('isValid:', result.isValid);
console.log('\nErrors:');
result.errors.forEach(e => console.log('  -', e));
