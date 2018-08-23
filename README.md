# apollo-opentracing

- 🚀 Request & Field level resolvers are traced out of the box
- 🔧 Use the opentracing compatible tracer you like, e.g.
  - [jaeger](https://www.jaegertracing.io/)
  - [zipkin](https://github.com/DanielMSchmidt/zipkin-javascript-opentracing)

## Installation

Run `npm install --save apollo-opentracing` given that you already setup an opentracing tracer accordingly.

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
+   extensions: [() => new OpentracingExtension({
+     server: serverTracer,
+     local: localTracer,
+   })]
  })
)
```

## Connecting Services

![example image](demo.png)

To connect other services you need to use the opentracing [inject](http://opentracing.io/documentation/pages/api/cross-process-tracing.html) function of your tracer.
We pass the current span down to your resolvers as `context.span`, so you should use it.

You can also make use of it and add new logs or tags on the fly if you like.

## Contributing

Please feel free to add issues with new ideas, bugs and anything that might come up. 
Let's make performance measurement to everyone <3 


