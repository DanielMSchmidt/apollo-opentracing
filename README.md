# apollo-opentracing

## Installation

Run `npm install --save apollo-opentracing` given that you already setup an opentracing tracer accordingly

## Setup

We need three types of tracer (which could be identical if you like):

- server: Only used for the root (the first span we will start)
- local: Used to start every other span

```diff
+const OpentracingExtension = require("apollo-opentracing").default;
const {serverTracer, localTracer} = require("./tracer);

app.use(
  "/graphql",
  bodyParser.json(),
  graphqlExpress({
    schema,
+   extensions: [new OpentracingExtension({
+     server: serverTracer,
+     local: localTracer,
+   })]
  })
)
```
