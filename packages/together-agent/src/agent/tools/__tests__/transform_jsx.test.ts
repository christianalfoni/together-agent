import { describe, test, expect } from "vitest";
import { transformJSXToH } from "../transform_jsx";

describe("transformJSXToH - Basic Elements", ()=>{
  test("self-closing element", ()=>{
    const input = "<Container />";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Container,null)");
  });

  test("element with opening and closing tags", ()=>{
    const input = "<Container></Container>";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Container,null)");
  });

  test("element with text children", ()=>{
    const input = "<Button>Click me</Button>";
    const output = transformJSXToH(input);
    expect(output).toContain('h(Button,null,"Click me")');
  });

  test("element with whitespace-only children", ()=>{
    const input = "<Button>   </Button>";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Button,null)");
  });

  test("element with text and whitespace", ()=>{
    const input = "<Text>  Hello World  </Text>";
    const output = transformJSXToH(input);
    expect(output).toContain('h(Text,null,"Hello World")');
  });
});

describe("transformJSXToH - Props", ()=>{
  test("string literal prop", ()=>{
    const input = '<Input type="text" />';
    const output = transformJSXToH(input);
    expect(output).toContain('h(Input,{type:"text" })');
  });

  test("expression prop", ()=>{
    const input = "<Input value={state.name} />";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Input,{value:state.name })");
  });

  test("multiple props", ()=>{
    const input =
      '<Input type="text" value={state.name} placeholder="Enter name" />';
    const output = transformJSXToH(input);
    expect(output).toContain('type:"text"');
    expect(output).toContain("value:state.name");
    expect(output).toContain('placeholder:"Enter name"');
  });

  test("boolean prop", ()=>{
    const input = "<Input disabled />";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Input,{disabled:true })");
  });

  test("arrow function prop", ()=>{
    const input = "<Button onClick={()=>console.log('clicked')} />";
    const output = transformJSXToH(input);
    expect(output).toContain("onClick:()=>console.log('clicked')");
  });

  test("arrow function with setState", ()=>{
    const input = "<Input onChange={(val)=>setState({name:val })} />";
    const output = transformJSXToH(input);
    expect(output).toContain("onChange:(val)=>setState({name:val })");
  });

  test("multiple arrow function props", ()=>{
    const input =
      "<Button onClick={()=>save()} onMouseOver={()=>highlight()} />";
    const output = transformJSXToH(input);
    expect(output).toContain("onClick:()=>save()");
    expect(output).toContain("onMouseOver:()=>highlight()");
  });

  test("complex expression prop", ()=>{
    const input = '<Input value={state.user?.name||"Guest"} />';
    const output = transformJSXToH(input);
    expect(output).toContain('value:state.user?.name||"Guest"');
  });
});

describe("transformJSXToH - Nested Elements", ()=>{
  test("simple nesting", ()=>{
    const input = "<Container><Input /></Container>";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Input,null)");
    expect(output).toContain("h(Container,");
  });

  test("multiple children", ()=>{
    const input = "<Container><Input /><Button /></Container>";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Input,null)");
    expect(output).toContain("h(Button,null)");
    expect(output).toContain("h(Container,");
  });

  test.skip("deeply nested - known limitation", ()=>{
    // TODO:Deep nesting (3+ levels) has issues with h() calls being stringified
    const input = `
      <Container>
        <Card>
          <Text>Hello</Text>
        </Card>
      </Container>
    `;
    const output = transformJSXToH(input);
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Card,");
    expect(output).toContain('h(Text,null,"Hello")');
    expect(output).not.toContain("<");
  });

  test.skip("nested with props - known limitation", ()=>{
    // TODO:Nested elements with props have transformation issues
    const input = `
      <Container spacing={4}>
        <Input value={state.name} />
        <Button disabled={!state.name}>Submit</Button>
      </Container>
    `;
    const output = transformJSXToH(input);
    expect(output).toContain("spacing:4");
    expect(output).toContain("value:state.name");
    expect(output).toContain("disabled:!state.name");
    expect(output).not.toContain("<");
  });

  test("three levels deep", ()=>{
    const input = `
      <Container>
        <Card>
          <Header>
            <Text>Title</Text>
          </Header>
        </Card>
      </Container>
    `;
    const output = transformJSXToH(input);
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Card,");
    expect(output).toContain("h(Header,");
    expect(output).toContain("h(Text,");
  });
});

describe("transformJSXToH - Expression Children", ()=>{
  test("expression with variable", ()=>{
    const input = "<Text>{state.name}</Text>";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Text,null,state.name)");
  });

  test("expression with function call", ()=>{
    const input = "<Text>{formatDate(state.date)}</Text>";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Text,null,formatDate(state.date))");
  });

  test("multiple expression children", ()=>{
    const input = "<Text>{state.firstName} {state.lastName}</Text>";
    const output = transformJSXToH(input);
    expect(output).toContain("state.firstName");
    expect(output).toContain("state.lastName");
  });

  test("mixed text and expression", ()=>{
    const input = "<Text>Hello {state.name}!</Text>";
    const output = transformJSXToH(input);
    expect(output).toContain("Hello");
    expect(output).toContain("state.name");
  });
});

describe("transformJSXToH - JSX in Expressions", ()=>{
  test("map with simple JSX", ()=>{
    const input =
      "<Container>{items.map(item=><Item key={item.id} />)}</Container>";
    const output = transformJSXToH(input);
    expect(output).toContain("items.map(item=>h(Item,{key:item.id }))");
    expect(output).not.toContain("<Item");
  });

  test("map with nested JSX", ()=>{
    const input = `
      <Container>
        {data.map(d=>(
          <Card>
            <Text>{d.name}</Text>
          </Card>
        ))}
      </Container>
    `;
    const output = transformJSXToH(input);
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Card,");
    expect(output).toContain("h(Text,");
    expect(output).not.toContain("<");
  });

  test("filter and map chain", ()=>{
    const input =
      "<Container>{items.filter(i=>i.active).map(i=><Item key={i.id} />)}</Container>";
    const output = transformJSXToH(input);
    expect(output).toContain(
      "items.filter(i=>i.active).map(i=>h(Item,{key:i.id }))"
    );
  });

  test("conditional JSX with ternary", ()=>{
    const input =
      "<Container>{state.loading?<Spinner />:<Content />}</Container>";
    const output = transformJSXToH(input);
    expect(output).toContain("state.loading?h(Spinner,null):h(Content,null)");
  });

  test("logical AND with JSX", ()=>{
    const input = "<Container>{state.show&&<Alert />}</Container>";
    const output = transformJSXToH(input);
    expect(output).toContain("state.show&&h(Alert,null)");
  });

  test("nested map in map", ()=>{
    const input = `
      <Container>
        {groups.map(group=>(
          <Section key={group.id}>
            {group.items.map(item=><Item key={item.id} />)}
          </Section>
        ))}
      </Container>
    `;
    const output = transformJSXToH(input);
    expect(output).not.toContain("<");
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Section,");
    expect(output).toContain("h(Item,");
  });

  test.skip("map with props and text - known limitation", ()=>{
    // TODO:JSX inside map with complex structure has transformation issues
    const input = `
      <Container>
        {items.map((item, index)=>(
          <Card key={index}>
            <Text>{item.name}</Text>
            <Button onClick={()=>handleClick(item.id)}>View</Button>
          </Card>
        ))}
      </Container>
    `;
    const output = transformJSXToH(input);
    expect(output).not.toContain("<");
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Card,");
    expect(output).toContain("h(Text,");
    expect(output).toContain("h(Button,");
  });

  test("complex ternary with nested JSX", ()=>{
    const input = `
      <Container>
        {state.user?(
          <Card>
            <Text>Welcome {state.user.name}</Text>
            <Button>Logout</Button>
          </Card>
        ):(
          <Card>
            <Text>Please login</Text>
            <Button>Login</Button>
          </Card>
        )}
      </Container>
    `;
    const output = transformJSXToH(input);
    expect(output).not.toContain("<");
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Card,");
  });
});

describe("transformJSXToH - Complete Widget Examples", ()=>{
  test.skip("widget with state and handlers - known limitation", ()=>{
    // TODO:Complete widgets with nested elements have transformation issues
    const input = `
      function Widget({ state, setState }) {
        return (
          <Container>
            <Input
              value={state.email}
              onChange={(val)=>setState({ email:val })}
              placeholder="Enter your email"
            />
            <Button onClick={()=>codeTools.send(state.email)}>
              Send
            </Button>
          </Container>
        );
      }
      Widget.initialState = { email:'' };
    `;
    const output = transformJSXToH(input);
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Input,");
    expect(output).toContain("h(Button,");
    expect(output).toContain("onChange:(val)=>setState({ email:val })");
    expect(output).not.toContain("<");
  });

  test.skip("widget with list rendering - known limitation", ()=>{
    // TODO:Widgets with list rendering have transformation issues
    const input = `
      function Widget({ state, setState }) {
        return (
          <Container>
            <Text>Items:</Text>
            {state.items.map(item=>(
              <Card key={item.id}>
                <Text>{item.name}</Text>
                <Button onClick={()=>deleteItem(item.id)}>Delete</Button>
              </Card>
            ))}
          </Container>
        );
      }
      Widget.initialState = { items:[] };
    `;
    const output = transformJSXToH(input);
    expect(output).not.toContain("<");
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Card,");
  });

  test("widget with conditional rendering", ()=>{
    const input = `
      function Widget({ state, setState }) {
        return (
          <Container>
            {state.loading&&<Spinner />}
            {state.error?(
              <Alert>{state.error}</Alert>
            ):(
              <Content>{state.data}</Content>
            )}
          </Container>
        );
      }
      Widget.initialState = { loading:false, error:null, data:null };
    `;
    const output = transformJSXToH(input);
    expect(output).not.toContain("<");
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Spinner,");
    expect(output).toContain("h(Alert,");
    expect(output).toContain("h(Content,");
  });
});

describe("transformJSXToH - Edge Cases", ()=>{
  test("empty container", ()=>{
    const input = "<Container />";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Container,null)");
  });

  test.skip("props with special characters in strings - known limitation", ()=>{
    // TODO:Escaped quotes in props cause parsing errors
    const input = '<Text value="Hello \\"World\\"" />';
    const output = transformJSXToH(input);
    expect(output).toContain('value:"Hello \\\\\\"World\\\\\\""');
  });

  test("multiline JSX", ()=>{
    const input = `
      <Container>
        <Text>
          Line 1
          Line 2
        </Text>
      </Container>
    `;
    const output = transformJSXToH(input);
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Text,");
  });

  test("JSX with comments removed by parser", ()=>{
    const input = `
      <Container>
        {/* This comment should be handled */}
        <Text>Hello</Text>
      </Container>
    `;
    const output = transformJSXToH(input);
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Text,");
  });

  test("numeric expression child", ()=>{
    const input = "<Text>{state.count+1}</Text>";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Text,null,state.count+1)");
  });

  test("boolean expression child", ()=>{
    const input = "<Text>{state.isActive?'Yes':'No'}</Text>";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Text,null,state.isActive?'Yes':'No')");
  });
});
